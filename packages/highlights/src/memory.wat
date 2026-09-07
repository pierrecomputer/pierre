(module
  ;; memory map for highlights.wat

  ;; [64:2000) per-token theme and CSS-variable name tables.
  ;; lib/highlighter.ts mirrors the theme-table address.
  (const $mem.themeTable 64)          ;; 1024
  (const $mem.tokenCssTable 1088)     ;; 912

  ;; [2000:4112) lowercase word buffer and byte-set bitmaps.
  (const $mem.lexLowerScratch 2000)   ;; 64
  (const $mem.byteSets 2064)          ;; 2048

  ;; [4112:13504) emitter HTML fragments, caches, and streaming state.
  (const $mem.emitterHtml 4112)       ;; 152
  (const $mem.emitterSpanCache 4264)  ;; 4824
  (const $mem.emitterThemeCache 9088) ;; 384
  (const $mem.streamDelimiter 9472)   ;; 32
  (const $mem.streamState 9504)       ;; 4000

  ;; [13504:48608) keyword tables (one per language in name order)
  (const $mem.bashWords 13504)           ;; 256
  (const $mem.c3Words 13760)             ;; 1792
  (const $mem.cWords 15552)              ;; 1024
  (const $mem.clojureWords 16576)        ;; 512
  (const $mem.cmakeWords 17088)          ;; 896
  (const $mem.cppWords 17984)            ;; 1280
  (const $mem.csharpWords 19264)         ;; 1280
  (const $mem.dartWords 20544)           ;; 1152
  (const $mem.dockerfileWords 21696)     ;; 256
  (const $mem.elixirWords 21952)         ;; 896
  (const $mem.erlangWords 22848)         ;; 512
  (const $mem.fsharpWords 23360)         ;; 1024
  (const $mem.gleamWords 24384)          ;; 384
  (const $mem.glslWords 24768)           ;; 1152
  (const $mem.goWords 25920)             ;; 512
  (const $mem.groovyWords 26432)         ;; 640
  (const $mem.graphqlWords 27072)        ;; 384
  (const $mem.haskellWords 27456)        ;; 640
  (const $mem.hlslWords 28096)           ;; 1152
  (const $mem.javaWords 29248)           ;; 1024
  (const $mem.juliaWords 30272)          ;; 512
  (const $mem.kotlinWords 30784)         ;; 768
  (const $mem.lispWords 31552)           ;; 1280
  (const $mem.luaWords 32832)            ;; 256
  (const $mem.makefileWords 33088)       ;; 512
  (const $mem.matlabWords 33600)         ;; 384
  (const $mem.nixWords 33984)            ;; 384
  (const $mem.objcWords 34368)           ;; 1024
  (const $mem.ocamlWords 35392)          ;; 1536
  (const $mem.pascalWords 36928)         ;; 1792
  (const $mem.perlWords 38720)           ;; 1024
  (const $mem.powershellWords 39744)     ;; 1280
  (const $mem.protoWords 41024)          ;; 640
  (const $mem.pythonWords 41664)         ;; 1152
  (const $mem.rWords 42816)              ;; 256
  (const $mem.rubyWords 43072)           ;; 768
  (const $mem.rustWords 43840)           ;; 640
  (const $mem.scalaWords 44480)          ;; 512
  (const $mem.swiftWords 44992)          ;; 768
  (const $mem.terraformWords 45760)      ;; 384
  (const $mem.tsxWords 46144)            ;; 544
  (const $mem.watWords 46688)            ;; 384
  (const $mem.wgslWords 47072)           ;; 640
  (const $mem.zigWords 47712)            ;; 896

  ;; [48608:59280) per-language stacks and lookup tables.
  (const $mem.jsonStack 48608)                   ;; 1024
  (const $mem.jsBracketStack 49632)              ;; 1024
  (const $mem.jsTokenFlags 50656)                ;; 144
  (const $mem.jsTokenHighlightMap 50800)         ;; 160
  (const $mem.jsTemplateBracketStack 50960)      ;; 1024
  (const $mem.jsTemplateFn 51984)                ;; 1024
  (const $mem.jsxStack 53008)                    ;; 4096
  (const $mem.markdownFence 57104)               ;; 1056
  (const $mem.markdownFenceStack 58160)          ;; 96
  (const $mem.tomlStack 58256)                   ;; 1024
)
