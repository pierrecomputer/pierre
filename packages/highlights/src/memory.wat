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
      [1424:5008)     byte-set bitmaps (byteset.get)
      [5008:5160)     emitter HTML fragments
      [5160:9984)     emitter span-open fragment cache
      [9984:10368)    saved theme bytes for the emitter span cache
      [10368:10400)   streaming delimiter
      [10400:11936)   streaming lexer checkpoints
      [11936:24000)   language keyword tables (displacements and descriptors)
      [24000:32192)   keyword pool: the word bytes every table shares
      [32192:43184)   per-language stacks and lookup tables
      [43184:59200)   live tokenizer change list
      [59200:59328)   live tokenizer free-list heads
      [59328:65536)   free
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

  ;; [1360:5008) lowercase word buffer and byte-set bitmaps.
  (const $mem.lexLowerScratch 1360)          ;; 64
  (const $mem.byteSets 1424)                 ;; 3584

  ;; [5008:11936) emitter HTML fragments, caches, and streaming state.
  (const $mem.emitterHtml 5008)              ;; 152
  (const $mem.emitterSpanCache 5160)         ;; 4824: single-theme slots or a multi-theme arena
  (const $mem.emitterThemeCache 9984)        ;; 384
  (const $mem.streamDelimiter 10368)          ;; 32
  (const $mem.streamState 10400)              ;; 1536

  ;; [11936:32192) keyword tables, capacities rounded up to 32 bytes, then the
  ;; shared word pool at its 8191-byte addressing limit. Each region's end is
  ;; the next named address, checked during the build.
  (const $mem.angularWords 11936)            ;; 160
  (const $mem.bashWords 12096)               ;; 96
  (const $mem.batchWords 12192)              ;; 256
  (const $mem.cWords 12448)                  ;; 192
  (const $mem.c3Words 12640)                 ;; 384
  (const $mem.clojureWords 13024)            ;; 224
  (const $mem.cmakeWords 13248)              ;; 256
  (const $mem.cppWords 13504)                ;; 352
  (const $mem.csharpWords 13856)             ;; 416
  (const $mem.cudaWords 14272)               ;; 192
  (const $mem.dartWords 14464)               ;; 288
  (const $mem.dockerfileWords 14752)         ;; 64
  (const $mem.elixirWords 14816)             ;; 160
  (const $mem.elmWords 14976)                ;; 128
  (const $mem.erlangWords 15104)             ;; 192
  (const $mem.fortranWords 15296)            ;; 512
  (const $mem.fsharpWords 15808)             ;; 384
  (const $mem.gleamWords 16192)              ;; 128
  (const $mem.glslWords 16320)               ;; 288
  (const $mem.goWords 16608)                 ;; 192
  (const $mem.graphqlWords 16800)            ;; 96
  (const $mem.groovyWords 16896)             ;; 224
  (const $mem.haskellWords 17120)            ;; 224
  (const $mem.hlslWords 17344)               ;; 256
  (const $mem.javaWords 17600)               ;; 224
  (const $mem.juliaWords 17824)              ;; 192
  (const $mem.kotlinWords 18016)             ;; 256
  (const $mem.lispWords 18272)               ;; 320
  (const $mem.luaWords 18592)                ;; 96
  (const $mem.makefileWords 18688)           ;; 192
  (const $mem.matlabWords 18880)             ;; 160
  (const $mem.nixWords 19040)                ;; 128
  (const $mem.objcWords 19168)               ;; 288
  (const $mem.ocamlWords 19456)              ;; 256
  (const $mem.pascalWords 19712)             ;; 576
  (const $mem.perlWords 20288)               ;; 256
  (const $mem.powershellWords 20544)         ;; 352
  (const $mem.protoWords 20896)              ;; 160
  (const $mem.pythonWords 21056)             ;; 288
  (const $mem.rWords 21344)                  ;; 96
  (const $mem.rubyWords 21440)               ;; 192
  (const $mem.rustWords 21632)               ;; 224
  (const $mem.scalaWords 21856)              ;; 224
  (const $mem.solidityWords 22080)           ;; 448
  (const $mem.swiftWords 22528)              ;; 256
  (const $mem.terraformWords 22784)          ;; 96
  (const $mem.tsxWords 22880)                ;; 544: ECMAScript keyword table (js.wat)
  (const $mem.watWords 23424)                ;; 96
  (const $mem.wgslWords 23520)               ;; 192
  (const $mem.zigWords 23712)                ;; 288
  (const $mem.keywordPool 24000)             ;; 8192: word bytes shared by every table

  ;; [32192:43184) per-language stacks and lookup tables.
  (const $mem.jsonStack 32192)               ;; 1024
  (const $mem.jsBracketStack 33216)          ;; 1024
  (const $mem.jsTokenFlags 34240)            ;; 144
  (const $mem.jsTokenHighlightMap 34384)     ;; 144
  (const $mem.jsTemplateBracketStack 34528)  ;; 1024
  (const $mem.jsTemplateFn 35552)            ;; 1024
  (const $mem.jsxStack 36576)                ;; 4096
  (const $mem.markdownFence 40672)           ;; 1392
  (const $mem.markdownFenceStack 42064)      ;; 96
  (const $mem.tomlStack 42160)               ;; 1024

  ;; Live tokenizer controls; the remaining first-page space is free.
  ;; The heap starts in page 2.
  (const $mem.liveChanges 43184)             ;; 16016: count + 1000 records, padded
  (const $mem.liveFree 59200)                ;; 128: 32 size-class free-list heads
  (const $mem.liveHeapStart 65536)
)
