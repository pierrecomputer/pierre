(module
  (;;
    memory structure
    [] page 1         (control, static data, and scratch)
      [0]             language id (u8)
      [1]             output mode (u8): 0 inline colors, 1 CSS variables,
                      2 packed theme set, 3 UTF-16 line records, 4 HTML openers
      [2:6)           input length (u32 LE)
      [6:10)          output start (u32 LE)
      [10:14)         output length (u32 LE)
      [14:18)         CSS-variable prefix or theme blob address (u32 LE)
      [18:22)         CSS-variable prefix or theme blob byte length (u32 LE)
      [22:64)         reserved space
      [64:448)        theme table written by JavaScript, five bytes per token
      [448:1360)      CSS-variable name table
      [1360:3408)     language names
      [3408:3472)     lowercase word copy for case-insensitive keyword lookups
      [3472:8592)     byte-set bitmaps (byteset.get)
      [8592:8744)     emitter HTML fragments
      [8744:13568)    emitter span-open fragment cache
      [13568:13952)   saved theme bytes for the emitter span cache
      [13952:13984)   streaming delimiter
      [13984:28416)   language keyword tables (displacements and descriptors)
      [28416:36608)   language keyword tables added later, then free
      [36608:46224)   per-language stacks and lookup tables
      [46224:49296)   streaming lexer checkpoints
      [49296:65536)   keyword pool: the word bytes every table shares
    [] pages 2..N     (text buffer; a live instance lays them out itself, see src/live.wat)
      [65536:EOF)     input, NUL sentinel, then at least 16 bytes of slack
      [(EOF+47)&~15:) prefix bytes (mode 1) or theme blob (modes 2/4), then HTML;
                      other modes start output here directly;
                      $ensureCap grows memory
  ;;)
  (memory (export "memory") 3)

  ;; [64:1360) per-token theme and CSS-variable name tables.
  ;; lib/highlighter.ts mirrors the theme-table address and size.
  (const $mem.themeTable 64)                 ;; 384
  (const $mem.tokenCssTable 448)             ;; 912

  ;; [1360:8592) language names, lowercase word buffer, and byte-set bitmaps.
  (const $mem.languageNames 1360)            ;; 2048
  (const $mem.lexLowerScratch 3408)          ;; 64
  (const $mem.byteSets 3472)                 ;; 5120: 160 sets

  ;; [8592:13984) emitter HTML fragments, caches, and the streaming delimiter.
  (const $mem.emitterHtml 8592)              ;; 152
  (const $mem.emitterSpanCache 8744)         ;; 4824: single-theme slots or a multi-theme arena
  (const $mem.emitterThemeCache 13568)       ;; 384
  (const $mem.streamDelimiter 13952)         ;; 32

  ;; [13984:36608) keyword tables, capacities rounded up to 32 bytes. Each
  ;; region's end is the next named address, checked during the build. Tables
  ;; after zig were added later; append new ones before $mem.laterWordsEnd.
  (const $mem.angularWords 13984)            ;; 160
  (const $mem.bashWords 14144)               ;; 96
  (const $mem.batchWords 14240)              ;; 256
  (const $mem.cWords 14496)                  ;; 192
  (const $mem.c3Words 14688)                 ;; 384
  (const $mem.clojureWords 15072)            ;; 224
  (const $mem.cmakeWords 15296)              ;; 256
  (const $mem.cppWords 15552)                ;; 352
  (const $mem.csharpWords 15904)             ;; 416
  (const $mem.cudaWords 16320)               ;; 192
  (const $mem.dartWords 16512)               ;; 288
  (const $mem.dockerfileWords 16800)         ;; 64
  (const $mem.elixirWords 16864)             ;; 160
  (const $mem.elmWords 17024)                ;; 128
  (const $mem.erlangWords 17152)             ;; 192
  (const $mem.fortranWords 17344)            ;; 512
  (const $mem.fsharpWords 17856)             ;; 384
  (const $mem.gdTypes 18240)                 ;; 160
  (const $mem.gdPackedWords 18400)           ;; 64
  (const $mem.gdscriptWords 18464)           ;; 192
  (const $mem.gdshaderWords 18656)           ;; 832
  (const $mem.gdresourceWords 19488)         ;; 128
  (const $mem.gleamWords 19616)              ;; 128
  (const $mem.glslWords 19744)               ;; 288
  (const $mem.goWords 20032)                 ;; 192
  (const $mem.graphqlWords 20224)            ;; 96
  (const $mem.groqWords 20320)               ;; 64
  (const $mem.groovyWords 20384)             ;; 224
  (const $mem.haskellWords 20608)            ;; 224
  (const $mem.hlslWords 20832)               ;; 256
  (const $mem.javaWords 21088)               ;; 224
  (const $mem.juliaWords 21312)              ;; 192
  (const $mem.kotlinWords 21504)             ;; 256
  (const $mem.latexWords 21760)              ;; 288
  (const $mem.lispWords 22048)               ;; 320
  (const $mem.luaWords 22368)                ;; 96
  (const $mem.makefileWords 22464)           ;; 192
  (const $mem.matlabWords 22656)             ;; 160
  (const $mem.nimWords 22816)                ;; 384
  (const $mem.nixWords 23200)                ;; 128
  (const $mem.objcWords 23328)               ;; 288
  (const $mem.ocamlWords 23616)              ;; 256
  (const $mem.pascalWords 23872)             ;; 576
  (const $mem.perlWords 24448)               ;; 256
  (const $mem.phpWords 24704)                ;; 256
  (const $mem.powershellWords 24960)         ;; 352
  (const $mem.protoWords 25312)              ;; 160
  (const $mem.pythonWords 25472)             ;; 288
  (const $mem.rWords 25760)                  ;; 96
  (const $mem.rubyWords 25856)               ;; 224
  (const $mem.rustWords 26080)               ;; 224
  (const $mem.scalaWords 26304)              ;; 224
  (const $mem.solidityWords 26528)           ;; 416
  (const $mem.swiftWords 26944)              ;; 256
  (const $mem.terraformWords 27200)          ;; 96
  (const $mem.tsxWords 27296)                ;; 544: ECMAScript keyword table (js.wat)
  (const $mem.watWords 27840)                ;; 96
  (const $mem.wgslWords 27936)               ;; 192
  (const $mem.zigWords 28128)                ;; 288
  (const $mem.odinWords 28416)               ;; 288
  (const $mem.leanWords 28704)               ;; 544
  (const $mem.bladeWords 29248)              ;; 320
  (const $mem.razorWords 29568)              ;; 128
  (const $mem.twigWords 29696)               ;; 256
  (const $mem.jinjaWords 29952)              ;; 256
  (const $mem.liquidWords 30208)             ;; 224
  (const $mem.handlebarsWords 30432)         ;; 96
  (const $mem.pugWords 30528)                ;; 128
  (const $mem.coffeeWords 30656)             ;; 224
  (const $mem.nginxWords 30880)              ;; 96
  (const $mem.logWords 30976)                ;; 288
  (const $mem.verilogWords 31264)            ;; 512
  (const $mem.vhdlWords 31776)               ;; 416
  (const $mem.tclWords 32192)                ;; 320
  (const $mem.vimlWords 32512)               ;; 544
  (const $mem.awkWords 33056)                ;; 192
  (const $mem.gherkinWords 33248)            ;; 64
  (const $mem.gnuplotWords 33312)            ;; 512
  (const $mem.prismaWords 33824)             ;; 96
  (const $mem.bicepWords 33920)              ;; 160
  (const $mem.plsqlWords 34080)              ;; 480
  (const $mem.cobolWords 34560)              ;; 672
  (const $mem.adaWords 35232)                ;; 416
  (const $mem.apexWords 35648)               ;; 416
  (const $mem.haxeWords 36064)               ;; 224
  (const $mem.qmlWords 36288)                ;; 96
  (const $mem.prologWords 36384)             ;; 224
  (const $mem.laterWordsEnd 36608)

  ;; [36608:46224) per-language stacks and lookup tables.
  (const $mem.jsonStack 36608)               ;; 1024
  (const $mem.jsBracketStack 37632)          ;; 1024
  (const $mem.jsTokenFlags 38656)            ;; 144
  (const $mem.jsTokenHighlightMap 38800)     ;; 144
  (const $mem.jsTemplateBracketStack 38944)  ;; 1024
  (const $mem.jsTemplateFn 39968)            ;; 1024
  (const $mem.jsxStack 40992)                ;; 4096
  (const $mem.markdownFenceStack 45104)      ;; 96
  (const $mem.tomlStack 45200)               ;; 1024

  ;; [46224:65536) stream checkpoints, then the shared keyword word pool.
  ;; Descriptors address the pool with 14-bit offsets.
  (const $mem.streamState 46224)             ;; 3072
  (const $mem.keywordPool 49296)             ;; 16240: word bytes shared by every table
  (const $mem.keywordPoolEnd 65536)

  ;; Live tokenizer controls. Only a live instance uses them, and it does not
  ;; place input at page 2, so they lead its heap there.
  (const $mem.liveChanges 65536)             ;; 16016: count + 1000 records, padded
  (const $mem.liveFree 81552)                ;; 128: 32 size-class free-list heads
  (const $mem.liveLocals 81680)              ;; 512
  (const $mem.liveHeapStart 82192)
)
