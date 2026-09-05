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

  ;; [13120:41568) word tables, one per language in name order: js.wat's
  ;; hand-written ECMAScript table under tsx and a keyword table for every
  ;; other language. The size after each base is the range its table form
  ;; claims in the lexer; it leaves a little headroom above the bytes the
  ;; table needs.
  (const $mem.bashWords 13120)        ;; 256
  (const $mem.c3Words 13376)          ;; 1792
  (const $mem.cWords 15168)           ;; 1024
  (const $mem.cppWords 16192)         ;; 1280
  (const $mem.csharpWords 17472)      ;; 1280
  (const $mem.dartWords 18752)        ;; 1152
  (const $mem.dockerfileWords 19904)  ;; 256
  (const $mem.elixirWords 20160)      ;; 896
  (const $mem.erlangWords 21056)      ;; 512
  (const $mem.gleamWords 21568)       ;; 384
  (const $mem.glslWords 21952)        ;; 1152
  (const $mem.goWords 23104)          ;; 512
  (const $mem.graphqlWords 23616)     ;; 384
  (const $mem.haskellWords 24000)     ;; 640
  (const $mem.hlslWords 24640)        ;; 1152
  (const $mem.javaWords 25792)        ;; 1024
  (const $mem.kotlinWords 26816)      ;; 768
  (const $mem.lispWords 27584)        ;; 1280
  (const $mem.luaWords 28864)         ;; 256
  (const $mem.objcWords 29120)        ;; 1024
  (const $mem.ocamlWords 30144)       ;; 1536
  (const $mem.perlWords 31680)        ;; 1024
  (const $mem.powershellWords 32704)  ;; 1280
  (const $mem.protoWords 33984)       ;; 640
  (const $mem.pythonWords 34624)      ;; 1152
  (const $mem.rWords 35776)           ;; 256
  (const $mem.rubyWords 36032)        ;; 768
  (const $mem.rustWords 36800)        ;; 640
  (const $mem.scalaWords 37440)       ;; 512
  (const $mem.swiftWords 37952)       ;; 768
  (const $mem.terraformWords 38720)   ;; 384
  (const $mem.tsxWords 39104)         ;; 544
  (const $mem.watWords 39648)         ;; 384
  (const $mem.wgslWords 40032)        ;; 640
  (const $mem.zigWords 40672)         ;; 896

  ;; [41568:51216) the other per-language data in alphabetical order: the
  ;; JSON nesting stack, the markdown fence alias table and the fence
  ;; registers of nested markdown bodies (eight 12-byte records, one per
  ;; nesting depth), the TOML nesting stack, and the ECMAScript bracket-kind
  ;; stack, token-class bitset, token-kind map, template stack, and JSX-mode
  ;; stack; the rest of the page is free
  (const $mem.jsonStack 41568)              ;; 1024
  (const $mem.markdownFence 42592)          ;; 1056
  (const $mem.markdownFenceEnd 43648)
  (const $mem.markdownFenceStack 43648)     ;; 96
  (const $mem.markdownFenceStackEnd 43744)
  (const $mem.tomlStack 43744)              ;; 1024
  (const $mem.jsBracketStack 44768)         ;; 1024
  (const $mem.jsLexBits 45792)              ;; 144
  (const $mem.jsLexHl 45936)                ;; 160
  (const $mem.jsTemplateStack 46096)        ;; 1024
  (const $mem.jsxStack 47120)               ;; 4096
)
