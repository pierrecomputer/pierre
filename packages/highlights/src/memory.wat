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
      [64:544)        theme table written by JavaScript, five bytes per token
      [544:1888)      CSS-variable name table
      [1888:1952)     lowercase word copy for case-insensitive keyword lookups
      [1952:9120)     byte-set bitmaps (byteset.get)
      [9120:9272)     emitter HTML fragments
      [9272:15152)    emitter span-open fragment cache
      [15152:15632)   saved theme bytes for the emitter span cache
      [15632:15664)   streaming delimiter
      [15664:30096)   language keyword tables (displacements and descriptors)
      [30096:38288)   language keyword tables added later
      [38288:47904)   per-language stacks and lookup tables
      [47904:50976)   streaming lexer checkpoints
      [50976:61952)   language keyword tables added later
      [61952:62208)   styled-token HTML fragments
      [62208:62464)   free
      [62464:65536)   language names
    [] page 2
      [65536:81920)   keyword pool: the word bytes every table shares
    [] pages 2..N     (text buffer; a live instance lays them out itself, see src/live.wat)
      [81920:EOF)     input, NUL sentinel, then at least 16 bytes of slack
      [(EOF+47)&~15:) prefix bytes (mode 1) or theme blob (modes 2/4), then HTML;
                      other modes start output here directly;
                      $ensureCap grows memory
  ;;)
  (memory (export "memory") 3)

  ;; [64:1888) per-token theme and CSS-variable name tables.
  ;; lib/highlighter.ts mirrors the theme-table address and size.
  (const $mem.themeTable 64)                 ;; 480
  (const $mem.tokenCssTable 544)             ;; 1344

  ;; [1888:9120) lowercase word buffer and byte-set bitmaps.
  (const $mem.lexLowerScratch 1888)          ;; 64
  (const $mem.byteSets 1952)                 ;; 7168: 224 sets

  ;; [9120:15664) emitter HTML fragments, caches, and the streaming delimiter.
  (const $mem.emitterHtml 9120)              ;; 152
  (const $mem.emitterSpanCache 9272)         ;; 5880: single-theme slots or a multi-theme arena
  (const $mem.emitterThemeCache 15152)       ;; 480
  (const $mem.streamDelimiter 15632)         ;; 32

  ;; [15664:38288) keyword tables, capacities rounded up to 32 bytes. Each
  ;; region's end is the next named address, checked during the build. Tables
  ;; after zig were added later; append new ones after the stream checkpoints.
  (const $mem.angularWords 15664)            ;; 160
  (const $mem.bashWords 15824)               ;; 96
  (const $mem.batchWords 15920)              ;; 256
  (const $mem.cWords 16176)                  ;; 192
  (const $mem.c3Words 16368)                 ;; 384
  (const $mem.clojureWords 16752)            ;; 224
  (const $mem.cmakeWords 16976)              ;; 256
  (const $mem.cppWords 17232)                ;; 352
  (const $mem.csharpWords 17584)             ;; 416
  (const $mem.cudaWords 18000)               ;; 192
  (const $mem.dartWords 18192)               ;; 288
  (const $mem.dockerfileWords 18480)         ;; 64
  (const $mem.elixirWords 18544)             ;; 160
  (const $mem.elmWords 18704)                ;; 128
  (const $mem.erlangWords 18832)             ;; 192
  (const $mem.fortranWords 19024)            ;; 512
  (const $mem.fsharpWords 19536)             ;; 384
  (const $mem.gdTypes 19920)                 ;; 160
  (const $mem.gdPackedWords 20080)           ;; 64
  (const $mem.gdscriptWords 20144)           ;; 192
  (const $mem.gdshaderWords 20336)           ;; 832
  (const $mem.gdresourceWords 21168)         ;; 128
  (const $mem.gleamWords 21296)              ;; 128
  (const $mem.glslWords 21424)               ;; 288
  (const $mem.goWords 21712)                 ;; 192
  (const $mem.graphqlWords 21904)            ;; 96
  (const $mem.groqWords 22000)               ;; 64
  (const $mem.groovyWords 22064)             ;; 224
  (const $mem.haskellWords 22288)            ;; 224
  (const $mem.hlslWords 22512)               ;; 256
  (const $mem.javaWords 22768)               ;; 224
  (const $mem.juliaWords 22992)              ;; 192
  (const $mem.kotlinWords 23184)             ;; 256
  (const $mem.latexWords 23440)              ;; 288
  (const $mem.lispWords 23728)               ;; 320
  (const $mem.luaWords 24048)                ;; 96
  (const $mem.makefileWords 24144)           ;; 192
  (const $mem.matlabWords 24336)             ;; 160
  (const $mem.nimWords 24496)                ;; 384
  (const $mem.nixWords 24880)                ;; 128
  (const $mem.objcWords 25008)               ;; 288
  (const $mem.ocamlWords 25296)              ;; 256
  (const $mem.pascalWords 25552)             ;; 576
  (const $mem.perlWords 26128)               ;; 256
  (const $mem.phpWords 26384)                ;; 256
  (const $mem.powershellWords 26640)         ;; 352
  (const $mem.protoWords 26992)              ;; 160
  (const $mem.pythonWords 27152)             ;; 288
  (const $mem.rWords 27440)                  ;; 96
  (const $mem.rubyWords 27536)               ;; 224
  (const $mem.rustWords 27760)               ;; 224
  (const $mem.scalaWords 27984)              ;; 224
  (const $mem.solidityWords 28208)           ;; 416
  (const $mem.swiftWords 28624)              ;; 256
  (const $mem.terraformWords 28880)          ;; 96
  (const $mem.tsxWords 28976)                ;; 544: ECMAScript keyword table (js.wat)
  (const $mem.watWords 29520)                ;; 96
  (const $mem.wgslWords 29616)               ;; 192
  (const $mem.zigWords 29808)                ;; 288
  (const $mem.odinWords 30096)               ;; 288
  (const $mem.leanWords 30384)               ;; 544
  (const $mem.bladeWords 30928)              ;; 320
  (const $mem.razorWords 31248)              ;; 128
  (const $mem.twigWords 31376)               ;; 256
  (const $mem.jinjaWords 31632)              ;; 256
  (const $mem.liquidWords 31888)             ;; 224
  (const $mem.handlebarsWords 32112)         ;; 96
  (const $mem.pugWords 32208)                ;; 128
  (const $mem.coffeeWords 32336)             ;; 224
  (const $mem.nginxWords 32560)              ;; 96
  (const $mem.logWords 32656)                ;; 288
  (const $mem.verilogWords 32944)            ;; 512
  (const $mem.vhdlWords 33456)               ;; 416
  (const $mem.tclWords 33872)                ;; 320
  (const $mem.vimlWords 34192)               ;; 544
  (const $mem.awkWords 34736)                ;; 192
  (const $mem.gherkinWords 34928)            ;; 64
  (const $mem.gnuplotWords 34992)            ;; 512
  (const $mem.prismaWords 35504)             ;; 96
  (const $mem.bicepWords 35600)              ;; 160
  (const $mem.plsqlWords 35760)              ;; 480
  (const $mem.cobolWords 36240)              ;; 672
  (const $mem.adaWords 36912)                ;; 416
  (const $mem.apexWords 37328)               ;; 416
  (const $mem.haxeWords 37744)               ;; 224
  (const $mem.qmlWords 37968)                ;; 96
  (const $mem.prologWords 38064)             ;; 224
  (const $mem.laterWordsEnd 38288)

  ;; [38288:47904) per-language stacks and lookup tables.
  (const $mem.jsonStack 38288)               ;; 1024
  (const $mem.jsBracketStack 39312)          ;; 1024
  (const $mem.jsTokenFlags 40336)            ;; 144
  (const $mem.jsTokenHighlightMap 40480)     ;; 144
  (const $mem.jsTemplateBracketStack 40624)  ;; 1024
  (const $mem.jsTemplateFn 41648)            ;; 1024
  (const $mem.jsxStack 42672)                ;; 4096
  (const $mem.markdownFenceStack 46784)      ;; 96
  (const $mem.tomlStack 46880)               ;; 1024

  ;; [47904:50976) stream checkpoints.
  (const $mem.streamState 47904)             ;; 3072

  ;; [50976:62464) keyword tables added later, one block per group, then free.
  ;; group A
  (const $mem.rosmsgWords 50976)             ;; 384
  ;; group B
  (const $mem.fishWords 51360)               ;; 160
  (const $mem.justWords 51520)               ;; 96
  (const $mem.puppetWords 51616)             ;; 160
  (const $mem.applescriptWords 51776)        ;; 864
  ;; group C
  (const $mem.sparqlWords 52640)             ;; 320
  (const $mem.cypherWords 52960)             ;; 416
  (const $mem.codeqlWords 53376)             ;; 416
  ;; group D
  (const $mem.sasWords 53792)                ;; 640
  (const $mem.stataWords 54432)              ;; 576
  (const $mem.daxWords 55008)                ;; 640
  (const $mem.powerqueryWords 55648)         ;; 448
  ;; group E
  (const $mem.dWords 56096)                  ;; 384
  (const $mem.llvmWords 56480)               ;; 704
  (const $mem.openscadWords 57184)           ;; 96
  (const $mem.shaderlabWords 57280)          ;; 608
  ;; group F
  (const $mem.coqWords 57888)                ;; 480
  (const $mem.wolframWords 58368)            ;; 576
  (const $mem.jsonnetWords 58944)            ;; 224
  ;; group G
  (const $mem.mermaidWords 59168)            ;; 384
  (const $mem.typstWords 59552)              ;; 224
  (const $mem.bibtexWords 59776)             ;; 128
  (const $mem.stylusWords 59904)             ;; 288
  ;; group H
  (const $mem.luauWords 60192)               ;; 64
  (const $mem.hackWords 60256)               ;; 128
  (const $mem.abapWords 60384)               ;; 1216
  ;; group I
  (const $mem.moonbitWords 61600)            ;; 352
  (const $mem.styledHtml 61952)              ;; 256
  (const $mem.laterWordsFree 62208)

  ;; [62464:65536) language names for Markdown fences.
  (const $mem.languageNames 62464)           ;; 3072

  ;; [65536:81920) the shared keyword word pool. Descriptors address it with
  ;; 14-bit offsets.
  (const $mem.keywordPool 65536)             ;; 16384: word bytes shared by every table
  (const $mem.keywordPoolEnd 81920)

  ;; Input start for whole-buffer and stream runs.
  ;; lib/highlighter.ts mirrors this address.
  (const $mem.input 81920)

  ;; Live tokenizer controls. Only a live instance uses them, and it does not
  ;; place input at $mem.input, so they lead its heap there.
  (const $mem.liveChanges 81920)             ;; 16016: count + 1000 records, padded
  (const $mem.liveFree 97936)                ;; 128: 32 size-class free-list heads
  (const $mem.liveLocals 98064)              ;; 512
  (const $mem.liveHeapStart 98576)
)
