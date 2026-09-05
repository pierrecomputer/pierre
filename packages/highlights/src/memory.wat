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

  ;; [4112:13120) the emitter's HTML fragments, its span-open cache - 73
  ;; slots of 66 bytes holding each token's rendered span opener, filled per
  ;; run and cleared by $hlBegin - and the streaming state: the 32-byte
  ;; delimiter and the lexer checkpoints capped at 4000 bytes by
  ;; scripts/build.ts
  (const $mem.emitterHtml 4112)       ;; 152
  (const $mem.emitterSpanCache 4264)  ;; 4824
  (const $mem.streamDelimiter 9088)   ;; 32
  (const $mem.streamState 9120)       ;; 4000

  ;; [13120:48224) word tables, one per language in name order: js.wat's
  ;; hand-written ECMAScript table under tsx and a keyword table for every
  ;; other language. The size after each base is the range its table form
  ;; claims in the lexer; it leaves a little headroom above the bytes the
  ;; table needs.
  (const $mem.bashWords 13120)           ;; 256
  (const $mem.c3Words 13376)             ;; 1792
  (const $mem.cWords 15168)              ;; 1024
  (const $mem.clojureWords 16192)        ;; 512
  (const $mem.cmakeWords 16704)          ;; 896
  (const $mem.cppWords 17600)            ;; 1280
  (const $mem.csharpWords 18880)         ;; 1280
  (const $mem.dartWords 20160)           ;; 1152
  (const $mem.dockerfileWords 21312)     ;; 256
  (const $mem.elixirWords 21568)         ;; 896
  (const $mem.erlangWords 22464)         ;; 512
  (const $mem.fsharpWords 22976)         ;; 1024
  (const $mem.gleamWords 24000)          ;; 384
  (const $mem.glslWords 24384)           ;; 1152
  (const $mem.goWords 25536)             ;; 512
  (const $mem.groovyWords 26048)         ;; 640
  (const $mem.graphqlWords 26688)        ;; 384
  (const $mem.haskellWords 27072)        ;; 640
  (const $mem.hlslWords 27712)           ;; 1152
  (const $mem.javaWords 28864)           ;; 1024
  (const $mem.juliaWords 29888)          ;; 512
  (const $mem.kotlinWords 30400)         ;; 768
  (const $mem.lispWords 31168)           ;; 1280
  (const $mem.luaWords 32448)            ;; 256
  (const $mem.makefileWords 32704)       ;; 512
  (const $mem.matlabWords 33216)         ;; 384
  (const $mem.nixWords 33600)            ;; 384
  (const $mem.objcWords 33984)           ;; 1024
  (const $mem.ocamlWords 35008)          ;; 1536
  (const $mem.pascalWords 36544)         ;; 1792
  (const $mem.perlWords 38336)           ;; 1024
  (const $mem.powershellWords 39360)     ;; 1280
  (const $mem.protoWords 40640)          ;; 640
  (const $mem.pythonWords 41280)         ;; 1152
  (const $mem.rWords 42432)              ;; 256
  (const $mem.rubyWords 42688)           ;; 768
  (const $mem.rustWords 43456)           ;; 640
  (const $mem.scalaWords 44096)          ;; 512
  (const $mem.swiftWords 44608)          ;; 768
  (const $mem.terraformWords 45376)      ;; 384
  (const $mem.tsxWords 45760)            ;; 544
  (const $mem.watWords 46304)            ;; 384
  (const $mem.wgslWords 46688)           ;; 640
  (const $mem.zigWords 47328)            ;; 896

  ;; [48224:57872) the other per-language data in alphabetical order: the
  ;; JSON nesting stack, the markdown fence alias table and the fence
  ;; registers of nested markdown bodies (eight 12-byte records, one per
  ;; nesting depth), the TOML nesting stack, and the ECMAScript bracket-kind
  ;; stack, token-class bitset, token-kind map, template stack, and JSX-mode
  ;; stack; the rest of the page is free
  (const $mem.jsonStack 48224)                   ;; 1024
  (const $mem.markdownFence 49248)               ;; 1056
  (const $mem.markdownFenceEnd 50304)            ;; 0
  (const $mem.markdownFenceStack 50304)          ;; 96
  (const $mem.markdownFenceStackEnd 50400)       ;; 0
  (const $mem.tomlStack 50400)                   ;; 1024
  (const $mem.jsBracketStack 51424)              ;; 1024
  (const $mem.jsLexBits 52448)                   ;; 144
  (const $mem.jsLexHl 52592)                     ;; 160
  (const $mem.jsTemplateStack 52752)             ;; 1024
  (const $mem.jsxStack 53776)                    ;; 4096
)
