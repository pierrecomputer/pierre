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

  ;; [11008:35872) word tables: the ECMAScript and C word lists, then one
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
  (const $mem.elixirWords 18336)      ;; 896
  (const $mem.glslWords 19232)        ;; 1152
  (const $mem.goWords 20384)          ;; 512
  (const $mem.haskellWords 20896)     ;; 640
  (const $mem.hlslWords 21536)        ;; 1152
  (const $mem.javaWords 22688)        ;; 1024
  (const $mem.kotlinWords 23712)      ;; 768
  (const $mem.lispWords 24480)        ;; 1280
  (const $mem.luaWords 25760)         ;; 256
  (const $mem.objcWords 26016)        ;; 1024
  (const $mem.ocamlWords 27040)       ;; 1536
  (const $mem.perlWords 28576)        ;; 1024
  (const $mem.protoWords 29600)       ;; 640
  (const $mem.pythonWords 30240)      ;; 1152
  (const $mem.rubyWords 31392)        ;; 768
  (const $mem.rustWords 32160)        ;; 640
  (const $mem.swiftWords 32800)       ;; 768
  (const $mem.terraformWords 33568)   ;; 384
  (const $mem.watWords 33952)         ;; 384
  (const $mem.wgslWords 34336)        ;; 640
  (const $mem.zigWords 34976)         ;; 896

  ;; [35872:45264) the other per-language data, grouped by language: the
  ;; markdown fence alias table; the JSON and TOML nesting stacks; the
  ;; ECMAScript token-class bitset and its template, bracket-kind, and
  ;; JSX-mode stacks; the rest of the page is free
  (const $mem.markdownFence 35872)    ;; 1056
  (const $mem.markdownFenceEnd 36928)
  (const $mem.jsonStack 36928)        ;; 1024
  (const $mem.tomlStack 37952)        ;; 1024
  (const $mem.tsxLexBits 38976)       ;; 144
  (const $mem.tsxTemplateStack 39120) ;; 1024
  (const $mem.tsxBracketStack 40144)  ;; 1024
  (const $mem.tsxJsxStack 41168)      ;; 4096

  ;; The live tokenizer owns the text pages (see src/live.wat): the change
  ;; list of up to 1000 16-byte entries, the 32 size-class free-list heads
  ;; of its heap, and the heap itself
  (const $mem.liveChanges 65536)      ;; 16384
  (const $mem.liveFree 81920)         ;; 128
  (const $mem.liveHeapBase 86016)
)
