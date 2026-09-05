(module
  ;; Named addresses on page 1, in address order: the two per-token tables,
  ;; the lowercase word scratch and byte-set bitmaps, the emitter's HTML
  ;; fragments and cache with the streaming state, every
  ;; word table back to back, and the rest of the per-language data -
  ;; bitsets, hash, fence aliases, stacks. The forms that fill a region
  ;; enforce its bounds at build time: overlapping data segments and keyword
  ;; tables that outgrow their range are rejected, so moving a region means
  ;; editing only this file and the memory map in highlights.wat.

  ;; [64:2000) the per-token tables: the theme table JavaScript writes
  ;; before each run - five bytes per token, lib/highlighter.ts mirrors the
  ;; address - and the CSS-variable name table, three-byte records over a
  ;; blob of kebab-case suffixes
  (const $mem.themeTable 64)          ;; 1024
  (const $mem.tokenCssTable 1088)     ;; 912

  ;; [2000:4112) the lowercase word copy that case-insensitive keyword lookups
  ;; probe, then the byte-set bitmaps the byteset.get form emits - up to 64
  ;; sets of 32 bytes
  (const $mem.lexLowerScratch 2000)   ;; 64
  (const $mem.byteSets 2064)          ;; 2048

  ;; [4112:13504) the emitter's HTML fragments, its span-open cache - 73
  ;; slots of 66 bytes holding each token's rendered span opener, reused until
  ;; theme bytes or output style mode change - then 384 saved theme bytes
  ;; (73 five-byte records padded to SIMD pairs) and the streaming state:
  ;; 32-byte delimiter and the lexer checkpoints capped at 4000 bytes by
  ;; scripts/build.ts
  (const $mem.emitterHtml 4112)       ;; 152
  (const $mem.emitterSpanCache 4264)  ;; 4824
  (const $mem.emitterThemeCache 9088) ;; 384
  (const $mem.streamDelimiter 9472)   ;; 32
  (const $mem.streamState 9504)       ;; 4000

  ;; [13504:48608) word tables, one per language in name order: js.wat's
  ;; hand-written ECMAScript table under tsx and a keyword table for every
  ;; other language. The size after each base is the range its table form
  ;; claims in the lexer; it leaves a little headroom above the bytes the
  ;; table needs.
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

  ;; [48608:58256) the other per-language data in alphabetical order: the
  ;; JSON nesting stack, the markdown fence alias table and the fence
  ;; registers of nested markdown bodies (eight 12-byte records, one per
  ;; nesting depth), the TOML nesting stack, and the ECMAScript bracket-kind
  ;; stack, token-class bitset, token-kind map, template stack, and JSX-mode
  ;; stack
  (const $mem.jsonStack 48608)                   ;; 1024
  (const $mem.markdownFence 49632)               ;; 1056
  (const $mem.markdownFenceEnd 50688)            ;; 0
  (const $mem.markdownFenceStack 50688)          ;; 96
  (const $mem.markdownFenceStackEnd 50784)       ;; 0
  (const $mem.tomlStack 50784)                   ;; 1024
  (const $mem.jsBracketStack 51808)              ;; 1024
  (const $mem.jsLexBits 52832)                   ;; 144
  (const $mem.jsLexHl 52976)                     ;; 160
  (const $mem.jsTemplateStack 53136)             ;; 1024
  (const $mem.jsxStack 54160)                    ;; 4096
)
