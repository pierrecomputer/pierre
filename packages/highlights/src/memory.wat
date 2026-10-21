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
      [13984:28416)   language keyword tables (displacements and descriptors)
      [28416:36608)   keyword pool: the word bytes every table shares
      [36608:46224)   per-language stacks and lookup tables
      [46224:62240)   live tokenizer change list
      [62240:62368)   live tokenizer free-list heads
      [62368:62880)   suspended live lexer locals
      [62880:64928)   odin keyword table (outside the packed block)
      [64928:65536)   Lean keyword table
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

  ;; [13984:36608) keyword tables, capacities rounded up to 32 bytes, then the
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
  (const $mem.rubyWords 25856)               ;; 192
  (const $mem.rustWords 26048)               ;; 224
  (const $mem.scalaWords 26272)              ;; 224
  (const $mem.solidityWords 26496)           ;; 448
  (const $mem.swiftWords 26944)              ;; 256
  (const $mem.terraformWords 27200)          ;; 96
  (const $mem.tsxWords 27296)                ;; 544: ECMAScript keyword table (js.wat)
  (const $mem.watWords 27840)                ;; 96
  (const $mem.wgslWords 27936)               ;; 192
  (const $mem.zigWords 28128)                ;; 288
  (const $mem.keywordPool 28416)             ;; 8192: word bytes shared by every table

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

  ;; Live tokenizer controls.
  ;; The heap starts in page 2.
  (const $mem.liveChanges 46224)             ;; 16016: count + 1000 records, padded
  (const $mem.liveFree 62240)                ;; 128: 32 size-class free-list heads
  (const $mem.liveLocals 62368)              ;; 512
  ;; [62880:65536) was free. The odin keyword table starts here so the
  ;; alphabetical tables above keep their addresses.
  (const $mem.odinWords 62880)               ;; 2048
  (const $mem.odinWordsEnd 64928)
  (const $mem.leanWords 64928)               ;; 608
  (const $mem.leanWordsEnd 65536)
  (const $mem.liveHeapStart 65536)
)
