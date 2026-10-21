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
      [13984:28352)   language keyword tables (displacements and descriptors)
      [28352:36544)   keyword pool: the word bytes every table shares
      [36544:46160)   per-language stacks and lookup tables
      [46160:62176)   live tokenizer change list
      [62176:62304)   live tokenizer free-list heads
      [62304:62816)   suspended live lexer locals
      [62816:65536)   free
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

  ;; [13984:36544) keyword tables, capacities rounded up to 32 bytes, then the
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
  (const $mem.latexWords 21696)              ;; 288
  (const $mem.lispWords 21984)               ;; 320
  (const $mem.luaWords 22304)                ;; 96
  (const $mem.makefileWords 22400)           ;; 192
  (const $mem.matlabWords 22592)             ;; 160
  (const $mem.nimWords 22752)                ;; 384
  (const $mem.nixWords 23136)                ;; 128
  (const $mem.objcWords 23264)               ;; 288
  (const $mem.ocamlWords 23552)              ;; 256
  (const $mem.pascalWords 23808)             ;; 576
  (const $mem.perlWords 24384)               ;; 256
  (const $mem.phpWords 24640)                ;; 256
  (const $mem.powershellWords 24896)         ;; 352
  (const $mem.protoWords 25248)              ;; 160
  (const $mem.pythonWords 25408)             ;; 288
  (const $mem.rWords 25696)                  ;; 96
  (const $mem.rubyWords 25792)               ;; 192
  (const $mem.rustWords 25984)               ;; 224
  (const $mem.scalaWords 26208)              ;; 224
  (const $mem.solidityWords 26432)           ;; 448
  (const $mem.swiftWords 26880)              ;; 256
  (const $mem.terraformWords 27136)          ;; 96
  (const $mem.tsxWords 27232)                ;; 544: ECMAScript keyword table (js.wat)
  (const $mem.watWords 27776)                ;; 96
  (const $mem.wgslWords 27872)               ;; 192
  (const $mem.zigWords 28064)                ;; 288
  (const $mem.keywordPool 28352)             ;; 8192: word bytes shared by every table

  ;; [36544:46160) per-language stacks and lookup tables.
  (const $mem.jsonStack 36544)               ;; 1024
  (const $mem.jsBracketStack 37568)          ;; 1024
  (const $mem.jsTokenFlags 38592)            ;; 144
  (const $mem.jsTokenHighlightMap 38736)     ;; 144
  (const $mem.jsTemplateBracketStack 38880)  ;; 1024
  (const $mem.jsTemplateFn 39904)            ;; 1024
  (const $mem.jsxStack 40928)                ;; 4096
  (const $mem.markdownFenceStack 45040)      ;; 96
  (const $mem.tomlStack 45136)               ;; 1024

  ;; Live tokenizer controls.
  ;; The heap starts in page 2.
  (const $mem.liveChanges 46160)             ;; 16016: count + 1000 records, padded
  (const $mem.liveFree 62176)                ;; 128: 32 size-class free-list heads
  (const $mem.liveLocals 62304)              ;; 512
  (const $mem.liveHeapStart 65536)
)
