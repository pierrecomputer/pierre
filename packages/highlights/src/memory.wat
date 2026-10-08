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
      [3472:7056)     byte-set bitmaps (byteset.get)
      [7056:7208)     emitter HTML fragments
      [7208:12032)    emitter span-open fragment cache
      [12032:12416)   saved theme bytes for the emitter span cache
      [12416:12448)   streaming delimiter
      [12448:13984)   streaming lexer checkpoints
      [13984:27680)   language keyword tables (displacements and descriptors)
      [27680:35872)   keyword pool: the word bytes every table shares
      [35872:45488)   per-language stacks and lookup tables
      [45488:61504)   live tokenizer change list
      [61504:61632)   live tokenizer free-list heads
      [61632:62144)   suspended live lexer locals
      [62144:65536)   free
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

  ;; [1360:7056) language names, lowercase word buffer, and byte-set bitmaps.
  (const $mem.languageNames 1360)            ;; 2048
  (const $mem.lexLowerScratch 3408)          ;; 64
  (const $mem.byteSets 3472)                 ;; 3584

  ;; [7056:13984) emitter HTML fragments, caches, and streaming state.
  (const $mem.emitterHtml 7056)              ;; 152
  (const $mem.emitterSpanCache 7208)         ;; 4824: single-theme slots or a multi-theme arena
  (const $mem.emitterThemeCache 12032)       ;; 384
  (const $mem.streamDelimiter 12416)         ;; 32
  (const $mem.streamState 12448)             ;; 1536

  ;; [13984:35872) keyword tables, capacities rounded up to 32 bytes, then the
  ;; shared word pool at its 8191-byte addressing limit. Each region's end is
  ;; the next named address, checked during the build.
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
  (const $mem.groovyWords 20320)             ;; 224
  (const $mem.haskellWords 20544)            ;; 224
  (const $mem.hlslWords 20768)               ;; 256
  (const $mem.javaWords 21024)               ;; 224
  (const $mem.juliaWords 21248)              ;; 192
  (const $mem.kotlinWords 21440)             ;; 256
  (const $mem.lispWords 21696)               ;; 320
  (const $mem.luaWords 22016)                ;; 96
  (const $mem.makefileWords 22112)           ;; 192
  (const $mem.matlabWords 22304)             ;; 160
  (const $mem.nixWords 22464)                ;; 128
  (const $mem.objcWords 22592)               ;; 288
  (const $mem.ocamlWords 22880)              ;; 256
  (const $mem.pascalWords 23136)             ;; 576
  (const $mem.perlWords 23712)               ;; 256
  (const $mem.phpWords 23968)                ;; 256
  (const $mem.powershellWords 24224)         ;; 352
  (const $mem.protoWords 24576)              ;; 160
  (const $mem.pythonWords 24736)             ;; 288
  (const $mem.rWords 25024)                  ;; 96
  (const $mem.rubyWords 25120)               ;; 192
  (const $mem.rustWords 25312)               ;; 224
  (const $mem.scalaWords 25536)              ;; 224
  (const $mem.solidityWords 25760)           ;; 448
  (const $mem.swiftWords 26208)              ;; 256
  (const $mem.terraformWords 26464)          ;; 96
  (const $mem.tsxWords 26560)                ;; 544: ECMAScript keyword table (js.wat)
  (const $mem.watWords 27104)                ;; 96
  (const $mem.wgslWords 27200)               ;; 192
  (const $mem.zigWords 27392)                ;; 288
  (const $mem.keywordPool 27680)             ;; 8192: word bytes shared by every table

  ;; [35872:45488) per-language stacks and lookup tables.
  (const $mem.jsonStack 35872)               ;; 1024
  (const $mem.jsBracketStack 36896)          ;; 1024
  (const $mem.jsTokenFlags 37920)            ;; 144
  (const $mem.jsTokenHighlightMap 38064)     ;; 144
  (const $mem.jsTemplateBracketStack 38208)  ;; 1024
  (const $mem.jsTemplateFn 39232)            ;; 1024
  (const $mem.jsxStack 40256)                ;; 4096
  (const $mem.markdownFenceStack 44368)      ;; 96
  (const $mem.tomlStack 44464)               ;; 1024

  ;; Live tokenizer controls.
  ;; The heap starts in page 2.
  (const $mem.liveChanges 45488)             ;; 16016: count + 1000 records, padded
  (const $mem.liveFree 61504)                ;; 128: 32 size-class free-list heads
  (const $mem.liveLocals 61632)              ;; 512
  (const $mem.liveHeapStart 65536)
)
