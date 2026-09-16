(module
  (;;
    memory structure
    [] page 1         (control, static data, and scratch)
      [0]             language id (u8)
      [1]             output mode (u8): 0 inline colors, 1 CSS variables, 3 UTF-16 line records
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
      [28736:39392)   per-language stacks and lookup tables
      [39392:55408)   live tokenizer change list
      [55408:55536)   live tokenizer free-list heads
      [55536:65536)   free
    [] pages 2..N     (text buffer; a live instance lays them out itself, see src/live.wat)
      [65536:EOF)     input, NUL sentinel, then at least 16 bytes of slack
      [(EOF+47)&~15:) CSS-variable prefix bytes in mode 1, then output HTML;
                      other modes start output here directly;
                      $ensureCap grows memory
  ;;)
  (memory (export "memory") 3)

  ;; [64:1360) per-token theme and CSS-variable name tables.
  ;; lib/highlighter.ts mirrors the theme-table address and size.
  (const $mem.themeTable 64)                 ;; 384
  (const $mem.tokenCssTable 448)             ;; 912

  ;; [1360:3472) lowercase word buffer and byte-set bitmaps.
  (const $mem.lexLowerScratch 1360)          ;; 64
  (const $mem.byteSets 1424)                 ;; 2048

  ;; [3472:10144) emitter HTML fragments, caches, and streaming state.
  (const $mem.emitterHtml 3472)              ;; 152
  (const $mem.emitterSpanCache 3624)         ;; 4824: single-theme slots or a multi-theme arena
  (const $mem.emitterThemeCache 8448)        ;; 384
  (const $mem.streamDelimiter 8832)          ;; 32
  (const $mem.streamState 8864)              ;; 1280

  ;; [10144:28736) keyword tables, capacities rounded up to 32 bytes, then the
  ;; shared word pool at its 8191-byte addressing limit. Each region's end is
  ;; the next named address, checked during the build.
  (const $mem.bashWords 10144)               ;; 96
  (const $mem.c3Words 10240)                 ;; 352
  (const $mem.cWords 10592)                  ;; 192
  (const $mem.clojureWords 10784)            ;; 224
  (const $mem.cmakeWords 11008)              ;; 256
  (const $mem.cppWords 11264)                ;; 352
  (const $mem.csharpWords 11616)             ;; 416
  (const $mem.dartWords 12032)               ;; 288
  (const $mem.dockerfileWords 12320)         ;; 64
  (const $mem.elixirWords 12384)             ;; 160
  (const $mem.erlangWords 12544)             ;; 192
  (const $mem.fsharpWords 12736)             ;; 384
  (const $mem.gleamWords 13120)              ;; 128
  (const $mem.glslWords 13248)               ;; 288
  (const $mem.goWords 13536)                 ;; 192
  (const $mem.groovyWords 13728)             ;; 224
  (const $mem.graphqlWords 13952)            ;; 96
  (const $mem.haskellWords 14048)            ;; 224
  (const $mem.hlslWords 14272)               ;; 224
  (const $mem.javaWords 14496)               ;; 224
  (const $mem.juliaWords 14720)              ;; 192
  (const $mem.kotlinWords 14912)             ;; 256
  (const $mem.lispWords 15168)               ;; 320
  (const $mem.luaWords 15488)                ;; 96
  (const $mem.makefileWords 15584)           ;; 192
  (const $mem.matlabWords 15776)             ;; 160
  (const $mem.nixWords 15936)                ;; 128
  (const $mem.objcWords 16064)               ;; 288
  (const $mem.ocamlWords 16352)              ;; 256
  (const $mem.pascalWords 16608)             ;; 576
  (const $mem.perlWords 17184)               ;; 256
  (const $mem.powershellWords 17440)         ;; 352
  (const $mem.protoWords 17792)              ;; 160
  (const $mem.pythonWords 17952)             ;; 288
  (const $mem.rWords 18240)                  ;; 96
  (const $mem.rubyWords 18336)               ;; 192
  (const $mem.rustWords 18528)               ;; 224
  (const $mem.scalaWords 18752)              ;; 224
  (const $mem.swiftWords 18976)              ;; 256
  (const $mem.terraformWords 19232)          ;; 96
  (const $mem.tsxWords 19328)                ;; 544: ECMAScript keyword table (js.wat)
  (const $mem.watWords 19872)                ;; 96
  (const $mem.wgslWords 19968)               ;; 160
  (const $mem.zigWords 20128)                ;; 256
  (const $mem.angularWords 20384)            ;; 160
  (const $mem.keywordPool 20544)             ;; 8192: word bytes shared by every table

  ;; [28736:39392) per-language stacks and lookup tables.
  (const $mem.jsonStack 28736)               ;; 1024
  (const $mem.jsBracketStack 29760)          ;; 1024
  (const $mem.jsTokenFlags 30784)            ;; 144
  (const $mem.jsTokenHighlightMap 30928)     ;; 144
  (const $mem.jsTemplateBracketStack 31072)  ;; 1024
  (const $mem.jsTemplateFn 32096)            ;; 1024
  (const $mem.jsxStack 33120)                ;; 4096
  (const $mem.markdownFence 37216)           ;; 1056
  (const $mem.markdownFenceStack 38272)      ;; 96
  (const $mem.tomlStack 38368)               ;; 1024

  ;; [39392:55536) live tokenizer controls; [55536:65536) is free and
  ;; the heap starts in page 2.
  (const $mem.liveChanges 39392)             ;; 16016: count + 1000 records, padded
  (const $mem.liveFree 55408)                ;; 128: 32 size-class free-list heads
  (const $mem.liveHeapStart 65536)
)
