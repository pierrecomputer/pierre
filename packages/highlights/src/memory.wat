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
      [1424:3984)     byte-set bitmaps (byteset.get)
      [3984:4136)     emitter HTML fragments
      [4136:8960)     emitter span-open fragment cache
      [8960:9344)     saved theme bytes for the emitter span cache
      [9344:9376)     streaming delimiter
      [9376:10656)    streaming lexer checkpoints
      [10656:22592)   language keyword tables (displacements and descriptors)
      [22592:30784)   keyword pool: the word bytes every table shares
      [30784:41776)   per-language stacks and lookup tables
      [41776:57792)   live tokenizer change list
      [57792:57920)   live tokenizer free-list heads
      [57920:65536)   free
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

  ;; [1360:3984) lowercase word buffer and byte-set bitmaps.
  (const $mem.lexLowerScratch 1360)          ;; 64
  (const $mem.byteSets 1424)                 ;; 2560

  ;; [3984:10656) emitter HTML fragments, caches, and streaming state.
  (const $mem.emitterHtml 3984)              ;; 152
  (const $mem.emitterSpanCache 4136)         ;; 4824: single-theme slots or a multi-theme arena
  (const $mem.emitterThemeCache 8960)        ;; 384
  (const $mem.streamDelimiter 9344)          ;; 32
  (const $mem.streamState 9376)              ;; 1280

  ;; [10656:30784) keyword tables, capacities rounded up to 32 bytes, then the
  ;; shared word pool at its 8191-byte addressing limit. Each region's end is
  ;; the next named address, checked during the build.
  (const $mem.angularWords 10656)            ;; 160
  (const $mem.bashWords 10816)               ;; 96
  (const $mem.batchWords 10912)              ;; 256
  (const $mem.cWords 11168)                  ;; 192
  (const $mem.c3Words 11360)                 ;; 352
  (const $mem.clojureWords 11712)            ;; 224
  (const $mem.cmakeWords 11936)              ;; 256
  (const $mem.cppWords 12192)                ;; 352
  (const $mem.csharpWords 12544)             ;; 416
  (const $mem.cudaWords 12960)               ;; 192
  (const $mem.dartWords 13152)               ;; 288
  (const $mem.dockerfileWords 13440)         ;; 64
  (const $mem.elixirWords 13504)             ;; 160
  (const $mem.elmWords 13664)                ;; 128
  (const $mem.erlangWords 13792)             ;; 192
  (const $mem.fortranWords 13984)            ;; 512
  (const $mem.fsharpWords 14496)             ;; 384
  (const $mem.gleamWords 14880)              ;; 128
  (const $mem.glslWords 15008)               ;; 288
  (const $mem.goWords 15296)                 ;; 192
  (const $mem.graphqlWords 15488)            ;; 96
  (const $mem.groovyWords 15584)             ;; 224
  (const $mem.haskellWords 15808)            ;; 224
  (const $mem.hlslWords 16032)               ;; 224
  (const $mem.javaWords 16256)               ;; 224
  (const $mem.juliaWords 16480)              ;; 192
  (const $mem.kotlinWords 16672)             ;; 256
  (const $mem.lispWords 16928)               ;; 320
  (const $mem.luaWords 17248)                ;; 96
  (const $mem.makefileWords 17344)           ;; 192
  (const $mem.matlabWords 17536)             ;; 160
  (const $mem.nixWords 17696)                ;; 128
  (const $mem.objcWords 17824)               ;; 288
  (const $mem.ocamlWords 18112)              ;; 256
  (const $mem.pascalWords 18368)             ;; 576
  (const $mem.perlWords 18944)               ;; 256
  (const $mem.powershellWords 19200)         ;; 352
  (const $mem.protoWords 19552)              ;; 160
  (const $mem.pythonWords 19712)             ;; 288
  (const $mem.rWords 20000)                  ;; 96
  (const $mem.rubyWords 20096)               ;; 192
  (const $mem.rustWords 20288)               ;; 224
  (const $mem.scalaWords 20512)              ;; 224
  (const $mem.solidityWords 20736)           ;; 448
  (const $mem.swiftWords 21184)              ;; 256
  (const $mem.terraformWords 21440)          ;; 96
  (const $mem.tsxWords 21536)                ;; 544: ECMAScript keyword table (js.wat)
  (const $mem.watWords 22080)                ;; 96
  (const $mem.wgslWords 22176)               ;; 160
  (const $mem.zigWords 22336)                ;; 256
  (const $mem.keywordPool 22592)             ;; 8192: word bytes shared by every table

  ;; [30784:41776) per-language stacks and lookup tables.
  (const $mem.jsonStack 30784)               ;; 1024
  (const $mem.jsBracketStack 31808)          ;; 1024
  (const $mem.jsTokenFlags 32832)            ;; 144
  (const $mem.jsTokenHighlightMap 32976)     ;; 144
  (const $mem.jsTemplateBracketStack 33120)  ;; 1024
  (const $mem.jsTemplateFn 34144)            ;; 1024
  (const $mem.jsxStack 35168)                ;; 4096
  (const $mem.markdownFence 39264)           ;; 1392
  (const $mem.markdownFenceStack 40656)      ;; 96
  (const $mem.tomlStack 40752)               ;; 1024

  ;; Live tokenizer controls; the remaining first-page space is free.
  ;; The heap starts in page 2.
  (const $mem.liveChanges 41776)             ;; 16016: count + 1000 records, padded
  (const $mem.liveFree 57792)                ;; 128: 32 size-class free-list heads
  (const $mem.liveHeapStart 65536)
)
