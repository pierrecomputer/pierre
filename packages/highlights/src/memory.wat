(module
  ;; memory map for highlights.wat

  ;; [64:1360) per-token theme and CSS-variable name tables.
  ;; lib/highlighter.ts mirrors the theme-table address and size.
  (const $mem.themeTable 64)                  ;; 384
  (const $mem.tokenCssTable 448)              ;; 912

  ;; [1360:3472) lowercase word buffer and byte-set bitmaps.
  (const $mem.lexLowerScratch 1360)           ;; 64
  (const $mem.byteSets 1424)                  ;; 2048

  ;; [3472:10144) emitter HTML fragments, caches, and streaming state.
  (const $mem.emitterHtml 3472)               ;; 152
  (const $mem.emitterSpanCache 3624)          ;; 4824
  (const $mem.emitterThemeCache 8448)         ;; 384
  (const $mem.streamDelimiter 8832)           ;; 32
  (const $mem.streamState 8864)               ;; 1280

  ;; [10144:36960) keyword tables, capacities rounded up to 32 bytes.
  ;; Each table's end is the next named address, checked during the build.
  (const $mem.bashWords 10144)                ;; 256
  (const $mem.c3Words 10400)                  ;; 992
  (const $mem.cWords 11392)                   ;; 608
  (const $mem.clojureWords 12000)             ;; 512
  (const $mem.cmakeWords 12512)               ;; 864
  (const $mem.cppWords 13376)                 ;; 1024
  (const $mem.csharpWords 14400)              ;; 1024
  (const $mem.dartWords 15424)                ;; 800
  (const $mem.dockerfileWords 16224)          ;; 224
  (const $mem.elixirWords 16448)              ;; 448
  (const $mem.erlangWords 16896)              ;; 416
  (const $mem.fsharpWords 17312)              ;; 960
  (const $mem.gleamWords 18272)               ;; 256
  (const $mem.glslWords 18528)                ;; 1056
  (const $mem.goWords 19584)                  ;; 512
  (const $mem.groovyWords 20096)              ;; 576
  (const $mem.graphqlWords 20672)             ;; 256
  (const $mem.haskellWords 20928)             ;; 512
  (const $mem.hlslWords 21440)                ;; 640
  (const $mem.javaWords 22080)                ;; 576
  (const $mem.juliaWords 22656)               ;; 448
  (const $mem.kotlinWords 23104)              ;; 736
  (const $mem.lispWords 23840)                ;; 1024
  (const $mem.luaWords 24864)                 ;; 192
  (const $mem.makefileWords 25056)            ;; 512
  (const $mem.matlabWords 25568)              ;; 384
  (const $mem.nixWords 25952)                 ;; 288
  (const $mem.objcWords 26240)                ;; 960
  (const $mem.ocamlWords 27200)               ;; 672
  (const $mem.pascalWords 27872)              ;; 1728
  (const $mem.perlWords 29600)                ;; 672
  (const $mem.powershellWords 30272)          ;; 896
  (const $mem.protoWords 31168)               ;; 416
  (const $mem.pythonWords 31584)              ;; 768
  (const $mem.rWords 32352)                   ;; 192
  (const $mem.rubyWords 32544)                ;; 512
  (const $mem.rustWords 33056)                ;; 448
  (const $mem.scalaWords 33504)               ;; 512
  (const $mem.swiftWords 34016)               ;; 608
  (const $mem.terraformWords 34624)           ;; 256
  (const $mem.tsxWords 34880)                 ;; 544
  (const $mem.watWords 35424)                 ;; 256
  (const $mem.wgslWords 35680)                ;; 448
  (const $mem.zigWords 36128)                 ;; 832

  ;; [36960:47616) per-language stacks and lookup tables.
  (const $mem.jsonStack 36960)                ;; 1024
  (const $mem.jsBracketStack 37984)           ;; 1024
  (const $mem.jsTokenFlags 39008)             ;; 144
  (const $mem.jsTokenHighlightMap 39152)      ;; 144
  (const $mem.jsTemplateBracketStack 39296)   ;; 1024
  (const $mem.jsTemplateFn 40320)             ;; 1024
  (const $mem.jsxStack 41344)                 ;; 4096
  (const $mem.markdownFence 45440)            ;; 1056
  (const $mem.markdownFenceStack 46496)       ;; 96
  (const $mem.tomlStack 46592)                ;; 1024

  ;; [47616:63760) live tokenizer controls; the heap starts in page 2.
  (const $mem.liveChanges 47616)              ;; 16016: count + 1000 records, padded
  (const $mem.liveFree 63632)                 ;; 128: 32 size-class free-list heads
  (const $mem.liveHeapStart 65536)
)
