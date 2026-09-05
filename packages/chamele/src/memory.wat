(module
  ;; Named addresses on page 1, in address order: the two per-token tables,
  ;; the emitter's HTML fragments and cache with the streaming state, every
  ;; word table back to back, and the rest of the per-language data -
  ;; bitsets, hash, fence aliases, stacks. The forms that fill a region
  ;; enforce its bounds at build time: overlapping data segments and keyword
  ;; tables that outgrow their range are rejected, so moving a region means
  ;; editing only this file and the memory map in chamele.wat.

  ;; [64:2000) the per-token tables: the theme table JavaScript writes
  ;; before each run - five bytes per token, lib/highlighter.ts mirrors the
  ;; address - and the CSS-variable name table, three-byte records over a
  ;; blob of kebab-case suffixes
  (const $mem.themeTable 64)          ;; 1024
  (const $mem.tokenCssTable 1088)     ;; 912

  ;; [2000:11008) the emitter's HTML fragments, its span-open cache - 73
  ;; slots of 66 bytes holding each token's rendered span opener, filled per
  ;; run and cleared by $hlBegin - and the streaming state: the 32-byte
  ;; delimiter and the lexer checkpoints capped at 4000 bytes by
  ;; scripts/build.ts
  (const $mem.emitterHtml 2000)       ;; 144
  (const $mem.emitterSpanCache 2144)  ;; 4832
  (const $mem.streamDelimiter 6976)   ;; 32
  (const $mem.streamState 7008)       ;; 4000

  ;; [11008:39456) word tables: the ECMAScript and C word lists, then one
  ;; keyword table per language in language order. The size after each
  ;; keyword-table base is the range its table form claims in the lexer; it
  ;; leaves a little headroom above the bytes the table needs.
  (const $mem.tsxWords 11008)         ;; 544
  (const $mem.cWords 11552)           ;; 1024
  (const $mem.bashWords 12576)        ;; 256
  (const $mem.c3Words 12832)          ;; 1792
  (const $mem.cppWords 14624)         ;; 1280
  (const $mem.csharpWords 15904)      ;; 1280
  (const $mem.dartWords 17184)        ;; 1152
  (const $mem.dockerfileWords 18336)  ;; 256
  (const $mem.elixirWords 18592)      ;; 896
  (const $mem.erlangWords 19488)      ;; 512
  (const $mem.gleamWords 20000)       ;; 384
  (const $mem.glslWords 20384)        ;; 1152
  (const $mem.goWords 21536)          ;; 512
  (const $mem.graphqlWords 22048)     ;; 384
  (const $mem.haskellWords 22432)     ;; 640
  (const $mem.hlslWords 23072)        ;; 1152
  (const $mem.javaWords 24224)        ;; 1024
  (const $mem.kotlinWords 25248)      ;; 768
  (const $mem.lispWords 26016)        ;; 1280
  (const $mem.luaWords 27296)         ;; 256
  (const $mem.objcWords 27552)        ;; 1024
  (const $mem.ocamlWords 28576)       ;; 1536
  (const $mem.perlWords 30112)        ;; 1024
  (const $mem.powershellWords 31136)  ;; 1280
  (const $mem.protoWords 32416)       ;; 640
  (const $mem.pythonWords 33056)      ;; 1152
  (const $mem.rWords 34208)           ;; 256
  (const $mem.rubyWords 34464)        ;; 768
  (const $mem.rustWords 35232)        ;; 640
  (const $mem.scalaWords 35872)       ;; 512
  (const $mem.swiftWords 36384)       ;; 768
  (const $mem.terraformWords 37152)   ;; 384
  (const $mem.watWords 37536)         ;; 384
  (const $mem.wgslWords 37920)        ;; 640
  (const $mem.zigWords 38560)         ;; 896

  ;; [39456:48912) the other per-language data, grouped by language: the
  ;; markdown fence alias table; the JSON and TOML nesting stacks; the
  ;; ECMAScript token-class bitset and its template, bracket-kind, and
  ;; JSX-mode stacks; the lowercase word copy that case-insensitive keyword
  ;; lookups probe; the rest of the page is free
  (const $mem.markdownFence 39456)    ;; 1056
  (const $mem.markdownFenceEnd 40512)
  (const $mem.jsonStack 40512)        ;; 1024
  (const $mem.tomlStack 41536)        ;; 1024
  (const $mem.tsxLexBits 42560)       ;; 144
  (const $mem.tsxTemplateStack 42704) ;; 1024
  (const $mem.tsxBracketStack 43728)  ;; 1024
  (const $mem.tsxJsxStack 44752)      ;; 4096
  (const $mem.lexLowerScratch 48848)  ;; 64

  ;; The live tokenizer owns the text pages (see src/live.wat): the change
  ;; list of up to 1000 16-byte entries, the 32 size-class free-list heads
  ;; of its heap, and the heap itself
  (const $mem.liveChanges 65536)      ;; 16384
  (const $mem.liveFree 81920)         ;; 128
  (const $mem.liveHeapBase 86016)
)
