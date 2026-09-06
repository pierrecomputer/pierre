(module
  (import "../common.wat")
  (import "./tsx.wat")
  (import "./html.wat")
  (import "./css.wat")
  (import "./json.wat")
  (import "./bash.wat")
  (import "./c.wat")
  (import "./cpp.wat")
  (import "./go.wat")
  (import "./python.wat")
  (import "./rust.wat")
  (import "./yaml.wat")
  (import "./php.wat")
  (import "./sql.wat")
  (import "./swift.wat")
  (import "./haskell.wat")
  (import "./kotlin.wat")
  (import "./astro.wat")
  (import "./vue.wat")
  (import "./svelte.wat")
  (import "./xml.wat")
  (import "./mdx.wat")
  (import "./asm.wat")
  (import "./wat.wat")
  (import "./diff.wat")
  (import "./glsl.wat")
  (import "./lua.wat")

  (enum $MarkdownFenceLang
    "unknown"
    "tsx" "html" "css" "json" "bash" "c" "cpp" "go" "python"
    "rust" "yaml" "php" "sql" "swift" "haskell" "kotlin" "astro"
    "vue" "svelte" "xml" "markdown" "mdx" "asm" "wat" "diff" "glsl" "lua"
    "js" "jsx" "ts"
  )

  ;; Public language aliases: 16-byte records containing length, enum id, and
  ;; up to ten lowercase bytes. Fences are rare, so one compact linear table
  ;; costs less code than a 66-way comparison ladder.
  (data (i32.const $mem.markdownFence)
    "\03\01\74\73\78\00\00\00\00\00\00\00\00\00\00\00\02\1e\74\73\00\00\00\00\00\00\00\00\00\00\00\00\0a\1e\74\79\70\65\73\63\72\69\70\74\00\00\00\00\0a\1c\6a\61\76\61\73\63\72\69\70\74\00\00\00\00\02\1c\6a\73\00\00\00\00\00\00\00\00\00\00\00\00\03\1d\6a\73\78\00\00\00\00\00\00\00\00\00\00\00\03\1c\63\6a\73\00\00\00\00\00\00\00\00\00\00\00\03\1c\6d\6a\73\00\00\00\00\00\00\00\00\00\00\00\03\1e\63\74\73\00\00\00\00\00\00\00\00\00\00\00\03\1e\6d\74\73\00\00\00\00\00\00\00\00\00\00\00\04\02\68\74\6d\6c\00\00\00\00\00\00\00\00\00\00\03\02\68\74\6d\00\00\00\00\00\00\00\00\00\00\00\03\03\63\73\73\00\00\00\00\00\00\00\00\00\00\00\04\04\6a\73\6f\6e\00\00\00\00\00\00\00\00\00\00\05\04\6a\73\6f\6e\63\00\00\00\00\00\00\00\00\00\04\05\62\61\73\68\00\00\00\00\00\00\00\00\00\00"
    "\02\05\73\68\00\00\00\00\00\00\00\00\00\00\00\00\05\05\73\68\65\6c\6c\00\00\00\00\00\00\00\00\00\03\05\7a\73\68\00\00\00\00\00\00\00\00\00\00\00\01\06\63\00\00\00\00\00\00\00\00\00\00\00\00\00\01\06\68\00\00\00\00\00\00\00\00\00\00\00\00\00\03\07\63\70\70\00\00\00\00\00\00\00\00\00\00\00\03\07\63\2b\2b\00\00\00\00\00\00\00\00\00\00\00\02\07\63\63\00\00\00\00\00\00\00\00\00\00\00\00\03\07\63\78\78\00\00\00\00\00\00\00\00\00\00\00\02\07\68\68\00\00\00\00\00\00\00\00\00\00\00\00\03\07\68\70\70\00\00\00\00\00\00\00\00\00\00\00\03\07\68\78\78\00\00\00\00\00\00\00\00\00\00\00\02\08\67\6f\00\00\00\00\00\00\00\00\00\00\00\00\06\08\67\6f\6c\61\6e\67\00\00\00\00\00\00\00\00\06\09\70\79\74\68\6f\6e\00\00\00\00\00\00\00\00\02\09\70\79\00\00\00\00\00\00\00\00\00\00\00\00"
    "\04\0a\72\75\73\74\00\00\00\00\00\00\00\00\00\00\02\0a\72\73\00\00\00\00\00\00\00\00\00\00\00\00\04\0b\79\61\6d\6c\00\00\00\00\00\00\00\00\00\00\03\0b\79\6d\6c\00\00\00\00\00\00\00\00\00\00\00\03\0c\70\68\70\00\00\00\00\00\00\00\00\00\00\00\03\0d\73\71\6c\00\00\00\00\00\00\00\00\00\00\00\05\0e\73\77\69\66\74\00\00\00\00\00\00\00\00\00\07\0f\68\61\73\6b\65\6c\6c\00\00\00\00\00\00\00\02\0f\68\73\00\00\00\00\00\00\00\00\00\00\00\00\06\10\6b\6f\74\6c\69\6e\00\00\00\00\00\00\00\00\02\10\6b\74\00\00\00\00\00\00\00\00\00\00\00\00\03\10\6b\74\73\00\00\00\00\00\00\00\00\00\00\00\05\11\61\73\74\72\6f\00\00\00\00\00\00\00\00\00\03\12\76\75\65\00\00\00\00\00\00\00\00\00\00\00\06\13\73\76\65\6c\74\65\00\00\00\00\00\00\00\00\03\14\78\6d\6c\00\00\00\00\00\00\00\00\00\00\00"
    "\03\14\73\76\67\00\00\00\00\00\00\00\00\00\00\00\03\14\78\73\64\00\00\00\00\00\00\00\00\00\00\00\08\15\6d\61\72\6b\64\6f\77\6e\00\00\00\00\00\00\02\15\6d\64\00\00\00\00\00\00\00\00\00\00\00\00\03\16\6d\64\78\00\00\00\00\00\00\00\00\00\00\00\03\17\61\73\6d\00\00\00\00\00\00\00\00\00\00\00\08\17\61\73\73\65\6d\62\6c\79\00\00\00\00\00\00\01\17\73\00\00\00\00\00\00\00\00\00\00\00\00\00\03\18\77\61\74\00\00\00\00\00\00\00\00\00\00\00\04\18\77\61\73\6d\00\00\00\00\00\00\00\00\00\00\04\19\64\69\66\66\00\00\00\00\00\00\00\00\00\00\05\19\70\61\74\63\68\00\00\00\00\00\00\00\00\00\04\1a\67\6c\73\6c\00\00\00\00\00\00\00\00\00\00\04\1a\63\6f\6d\70\00\00\00\00\00\00\00\00\00\00\04\1a\66\72\61\67\00\00\00\00\00\00\00\00\00\00\04\1a\67\65\6f\6d\00\00\00\00\00\00\00\00\00\00"
    "\04\1a\76\65\72\74\00\00\00\00\00\00\00\00\00\00\03\1b\6c\75\61\00\00\00\00\00\00\00\00\00\00\00"
  )

  (func $markdownFenceLang (param $lhs i32) (param $rhs i32) (result i32)
    (local $len i32)
    (local $rem i32)
    (local $record i32)
    (local $mask i64)
    (local $word i64)
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.or (i32.eqz (local.get $len)) (i32.gt_u (local.get $len) (i32.const 10)))
      (then (return (enum.get $MarkdownFenceLang.unknown))))
    (local.set $record (i32.const $mem.markdownFence))
    (block $done
      (loop $alias
        (br_if $done (i32.ge_u (local.get $record) (i32.const $mem.markdownFenceEnd)))
        (if (i32.eq (local.get $len) (i32.load8_u (local.get $record)))
          (then
            (local.set $word (i64.or
              (i64.load (local.get $lhs)) (i64.const 0x2020202020202020)))
            (if (i32.le_u (local.get $len) (i32.const 8))
              (then
                (local.set $mask (select
                  (i64.const -1)
                  (i64.sub
                    (i64.shl (i64.const 1)
                      (i64.extend_i32_u (i32.shl (local.get $len) (i32.const 3))))
                    (i64.const 1))
                  (i32.eq (local.get $len) (i32.const 8)))))
              (else (local.set $mask (i64.const -1))))
            (if (i64.eq
                  (i64.and (local.get $word) (local.get $mask))
                  (i64.load offset=2 (local.get $record)))
              (then
                (if (i32.le_u (local.get $len) (i32.const 8))
                  (then (return (i32.load8_u offset=1 (local.get $record)))))
                (local.set $rem (i32.sub (local.get $len) (i32.const 8)))
                (if (i32.eq
                      (i32.and
                        (i32.or
                          (i32.load offset=8 (local.get $lhs))
                          (i32.const 0x20202020))
                        (i32.sub
                          (i32.shl (i32.const 1) (i32.shl (local.get $rem) (i32.const 3)))
                          (i32.const 1)))
                      (i32.load offset=10 (local.get $record)))
                  (then (return (i32.load8_u offset=1 (local.get $record)))))))))
        (local.set $record (i32.add (local.get $record) (i32.const 16)))
        (br $alias)))
    (enum.get $MarkdownFenceLang.unknown))

  ;; A fence can name `markdown` (or `mdx`, which re-enters markdown), so the
  ;; nesting depth is chosen by the input. The counter is raised and lowered
  ;; around each delegation and so returns to zero on its own; never reset it
  ;; in `$hlMarkdown`, which is itself one of the recursive entry points.
  (global $markdownDepth (mut i32) (i32.const 0))
  ;; The fence left open at the end of a stream chunk, so the next chunk
  ;; resumes its body: the fence byte, its run length with the block-quote
  ;; depth packed above, and the body language. The globals hold the
  ;; document's own fence. A fence opened inside a `markdown` or `mdx` fence
  ;; body keeps its registers in $mem.markdownFenceStack at its nesting
  ;; depth, so an inner fence survives the chunk boundary alongside the outer
  ;; one instead of being overwritten by it. The live tokenizer captures both
  ;; and $streamResetGlobals clears both.
  (global $markdownStreamFence (mut i32) (i32.const 0))
  (global $markdownStreamFenceLen (mut i32) (i32.const 0))
  (global $markdownStreamLang (mut i32) (i32.const 0))

  ;; Address of the 12-byte fence register record for nesting depth $depth
  ;; (1..8); depth 0 lives in the globals above.
  (func $markdownFenceSlot (param $depth i32) (result i32)
    (i32.add (i32.const $mem.markdownFenceStack)
      (i32.mul (i32.sub (local.get $depth) (i32.const 1)) (i32.const 12))))

  ;; Fence byte of the fence left open at the current depth, 0 when none.
  (func $markdownFenceReg (result i32)
    (if (i32.eqz (global.get $markdownDepth))
      (then (return (global.get $markdownStreamFence))))
    (i32.load (call $markdownFenceSlot (global.get $markdownDepth))))

  (func $markdownFenceLenReg (result i32)
    (if (i32.eqz (global.get $markdownDepth))
      (then (return (global.get $markdownStreamFenceLen))))
    (i32.load offset=4 (call $markdownFenceSlot (global.get $markdownDepth))))

  (func $markdownFenceLangReg (result i32)
    (if (i32.eqz (global.get $markdownDepth))
      (then (return (global.get $markdownStreamLang))))
    (i32.load offset=8 (call $markdownFenceSlot (global.get $markdownDepth))))

  ;; Record the fence left open at the current depth; a zero $fence clears it.
  (func $markdownFenceSet (param $fence i32) (param $len i32) (param $lang i32)
    (local $slot i32)
    (if (i32.eqz (global.get $markdownDepth))
      (then
        (global.set $markdownStreamFence (local.get $fence))
        (global.set $markdownStreamFenceLen (local.get $len))
        (global.set $markdownStreamLang (local.get $lang))
        (return)))
    (local.set $slot (call $markdownFenceSlot (global.get $markdownDepth)))
    (i32.store (local.get $slot) (local.get $fence))
    (i32.store offset=4 (local.get $slot) (local.get $len))
    (i32.store offset=8 (local.get $slot) (local.get $lang)))

  ;; Forget the fences recorded by bodies nested below the current depth.
  ;; Once the fence at this depth closes, whatever its body left open is
  ;; text of a finished block and must not resume in a later chunk.
  (func $markdownFenceClearDeeper
    (local $from i32)
    (local.set $from
      (call $markdownFenceSlot (i32.add (global.get $markdownDepth) (i32.const 1))))
    (if (i32.lt_u (local.get $from) (i32.const $mem.markdownFenceStackEnd))
      (then
        (memory.fill (local.get $from) (i32.const 0)
          (i32.sub (i32.const $mem.markdownFenceStackEnd) (local.get $from))))))

  (func $markdownCodeRange (param $lang i32) (param $from i32) (param $to i32)
    (local $save i32)
    (if (i32.ge_u (local.get $from) (local.get $to))
      (then (global.set $ptr (local.get $to)) (return)))
    ;; Past the limit the body stays literal text rather than growing the stack:
    ;; the contract says a lexer is total, and a trap would break that.
    (if (i32.ge_u (global.get $markdownDepth) (i32.const 8))
      (then
        (call $emitTok (enum.get $Token.text.literal) (local.get $from) (local.get $to))
        (global.set $ptr (local.get $to))
        (return)))
    (global.set $markdownDepth (i32.add (global.get $markdownDepth) (i32.const 1)))
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (global.set $ptr (local.get $from))
    (block $codeDone
      ;; A `markdown` or `mdx` body first resumes the fence its previous
      ;; chunk left open at this depth, as the document does at top level;
      ;; the lexer then continues after the closer, or the range is spent.
      (if (i32.and
            (global.get $streaming)
            (i32.ne (call $markdownFenceReg) (i32.const 0)))
        (then
          (br_if $codeDone (call $markdownStreamResume))
          (br_if $codeDone (i32.ge_u (global.get $ptr) (global.get $end)))))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.tsx)) (then (call $hlTsx) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.js)) (then (call $hlJs) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.jsx)) (then (call $hlJsx) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.ts)) (then (call $hlTs) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.html)) (then (call $hlHtml) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.css)) (then (call $hlCss) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.json)) (then (call $hlJson) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.bash)) (then (call $hlBash) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.c)) (then (call $hlC) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.cpp)) (then (call $hlCpp) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.go)) (then (call $hlGo) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.python)) (then (call $hlPython) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.rust)) (then (call $hlRust) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.yaml)) (then (call $hlYaml) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.php)) (then (call $hlPhp) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.sql)) (then (call $hlSql) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.swift)) (then (call $hlSwift) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.haskell)) (then (call $hlHaskell) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.kotlin)) (then (call $hlKotlin) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.astro)) (then (call $hlAstro) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.vue)) (then (call $hlVue) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.svelte)) (then (call $hlSvelte) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.xml)) (then (call $hlXml) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.markdown)) (then (call $hlMarkdown) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.mdx)) (then (call $hlMdx) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.asm)) (then (call $hlAsm) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.wat)) (then (call $hlWat) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.diff)) (then (call $hlDiff) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.glsl)) (then (call $hlGlsl) (br $codeDone)))
      (if (i32.eq (local.get $lang) (enum.get $MarkdownFenceLang.lua)) (then (call $hlLua) (br $codeDone))))
    (global.set $markdownDepth (i32.sub (global.get $markdownDepth) (i32.const 1)))
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $to)))

  ;; First CR or LF at or after $p, or $end - one SIMD compare per 16 bytes.
  ;; Every caller passes $p <= $end, so the shared finder's clamp to $end
  ;; matches the old scalar walk exactly.
  (func $markdownLineEnd (param $p i32) (result i32)
    (call $lexFindEither (local.get $p) (i32.const 10) (i32.const 13)))

  ;; ASCII letter or digit, or any byte of a non-ASCII code point: the
  ;; "alphanumeric" of CommonMark's flanking rules, approximated per byte.
  (func $markdownIsAlnum (param $c i32) (result i32)
    (i32.or
      (i32.ge_u (local.get $c) (i32.const 0x80))
      (i32.or
        (call $lexIsDigit (local.get $c))
        (i32.le_u
          (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a"))
          (i32.const 25)))))

  ;; ASCII punctuation, the only bytes a backslash may escape.
  (func $markdownIsPunct (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.le_u (i32.sub (local.get $c) (i32.const "!")) (i32.const 14))
        (i32.le_u (i32.sub (local.get $c) (i32.const ":")) (i32.const 6)))
      (i32.or
        (i32.le_u (i32.sub (local.get $c) (i32.const "[")) (i32.const 5))
        (i32.le_u (i32.sub (local.get $c) (i32.const "{")) (i32.const 3)))))

  (func $markdownAfterLine (param $p i32) (result i32)
    (if (i32.lt_u (local.get $p) (global.get $end))
      (then
        (if (i32.and
              (i32.eq (i32.load8_u (local.get $p)) (i32.const 13))
              (i32.and
                (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
                (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const 10))))
          (then (return (i32.add (local.get $p) (i32.const 2)))))
        (return (i32.add (local.get $p) (i32.const 1)))))
    (local.get $p))

  ;; Skip up to three spaces from $p, bounded by $stop: the indentation a
  ;; block construct may carry without becoming indented code.
  (func $markdownSkipIndent (param $p i32) (param $stop i32) (result i32)
    (local $n i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $n) (i32.const 3)))
        (br_if $done (i32.ge_u (local.get $p) (local.get $stop)))
        (br_if $done (i32.ne (i32.load8_u (local.get $p)) (i32.const 32)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (local.set $n (i32.add (local.get $n) (i32.const 1)))
        (br $l)))
    (local.get $p))

  ;; Start of the first line at or after $p that closes a fence: $quotes
  ;; block-quote markers, at most three spaces, a run of at least $len $fence
  ;; bytes, then only blanks. The indent and quote prefixes mirror what the
  ;; opener accepts, so fences inside list items and block quotes close.
  ;; Returns $end when the fence never closes. Shared with the MDX pre-scan
  ;; so the two lexers agree on where a fenced body ends.
  (func $markdownFenceClose
    (param $p i32) (param $fence i32) (param $len i32) (param $quotes i32)
    (result i32)
    (local $c i32)
    (local $lineEnd i32)
    (local $n i32)
    (local $q i32)
    (block $done
      (loop $lines
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $lineEnd (call $markdownLineEnd (local.get $p)))
        (local.set $q (local.get $p))
        (block $skip
          ;; each block-quote level: up to three spaces, `>`, one optional blank
          (local.set $n (local.get $quotes))
          (block $quotesDone
            (loop $quoteLevel
              (br_if $quotesDone (i32.eqz (local.get $n)))
              (local.set $q (call $markdownSkipIndent (local.get $q) (local.get $lineEnd)))
              (br_if $skip (i32.ge_u (local.get $q) (local.get $lineEnd)))
              (br_if $skip (i32.ne (i32.load8_u (local.get $q)) (i32.const ">")))
              (local.set $q (i32.add (local.get $q) (i32.const 1)))
              (if (i32.and
                    (i32.lt_u (local.get $q) (local.get $lineEnd))
                    (i32.eq (i32.load8_u (local.get $q)) (i32.const 32)))
                (then (local.set $q (i32.add (local.get $q) (i32.const 1)))))
              (local.set $n (i32.sub (local.get $n) (i32.const 1)))
              (br $quoteLevel)))
          (local.set $q (call $markdownSkipIndent (local.get $q) (local.get $lineEnd)))
          (local.set $n (local.get $q))
          (block $runDone
            (loop $run
              (br_if $runDone (i32.ge_u (local.get $q) (local.get $lineEnd)))
              (br_if $runDone (i32.ne (i32.load8_u (local.get $q)) (local.get $fence)))
              (local.set $q (i32.add (local.get $q) (i32.const 1)))
              (br $run)))
          (br_if $skip (i32.lt_u (i32.sub (local.get $q) (local.get $n)) (local.get $len)))
          (block $spaceDone
            (loop $space
              (br_if $spaceDone (i32.ge_u (local.get $q) (local.get $lineEnd)))
              (local.set $c (i32.load8_u (local.get $q)))
              (br_if $spaceDone (i32.and
                (i32.ne (local.get $c) (i32.const 32))
                (i32.ne (local.get $c) (i32.const 9))))
              (local.set $q (i32.add (local.get $q) (i32.const 1)))
              (br $space)))
          (if (i32.eq (local.get $q) (local.get $lineEnd))
            (then (return (local.get $p)))))
        (local.set $p (call $markdownAfterLine (local.get $lineEnd)))
        (br $lines)))
    (global.get $end))

  ;; Drop stream state left behind by an embedded range. A fence body or an
  ;; inline HTML range hands its bytes to another lexer over an $end swap; at
  ;; that inner end the lexer may checkpoint an open comment, string, or
  ;; script/style region as if the chunk ended there. Fence bodies re-lex
  ;; statelessly per chunk, and a range that ends before $eof continues as
  ;; markdown, so neither state may survive into the next chunk.
  (func $markdownClearEmbeddedStream
    (global.set $streamMode (i32.const 0))
    (global.set $streamRegionKind (i32.const 0))
    (global.set $streamRegionStarted (i32.const 0)))

  ;; Continue a fenced block whose closing delimiter is in a later stream
  ;; chunk. Returns one while the whole chunk belongs to the fence body.
  ;; The fence length register packs the block-quote depth of the opener
  ;; into its upper half so the closer scan can demand the same `>` prefix.
  ;; Runs at the current nesting depth: for the document itself from
  ;; $streamResumeLang, and for a nested markdown body from
  ;; $markdownCodeRange, which resumes a fence recorded one depth down.
  (func $markdownStreamResume (result i32)
    (local $after i32)
    (local $close i32)
    (local $fence i32)
    (local $lang i32)
    (local $len i32)
    (local $lineEnd i32)
    (local.set $fence (call $markdownFenceReg))
    (if (i32.eqz (local.get $fence))
      (then (return (i32.const 0))))
    (local.set $len (call $markdownFenceLenReg))
    (local.set $lang (call $markdownFenceLangReg))
    (local.set $close (call $markdownFenceClose (global.get $ptr)
      (local.get $fence)
      (i32.and (local.get $len) (i32.const 0xffff))
      (i32.shr_u (local.get $len) (i32.const 16))))
    (if (local.get $lang)
      (then
        ;; streamed fence bodies re-lex per chunk without carried state, so
        ;; clear the shared parameter-machine globals like the fence open does
        (call $sigReset)
        (call $markdownCodeRange
          (local.get $lang) (global.get $ptr) (local.get $close)))
      (else (call $emitTok
        (enum.get $Token.text.literal) (global.get $ptr) (local.get $close))))
    (call $markdownClearEmbeddedStream)
    ;; a nested body records its own fences one depth down, so the registers
    ;; at this depth still describe the fence being resumed
    (if (i32.eq (local.get $close) (global.get $end))
      (then (return (i32.const 1))))
    (global.set $ptr (local.get $close))
    (local.set $lineEnd (call $markdownLineEnd (global.get $ptr)))
    (local.set $after (call $markdownAfterLine (local.get $lineEnd)))
    (call $emitTok (enum.get $Token.punctuation.delimiter)
      (global.get $ptr) (local.get $after))
    (global.set $ptr (local.get $after))
    (call $markdownFenceSet (i32.const 0) (i32.const 0) (i32.const 0))
    (call $markdownFenceClearDeeper)
    (i32.const 0))

  (func $markdownPlainEnd (param $p i32) (result i32)
    (local $hits v128)
    (local $mask i32)
    (local $w v128)
    (block $tail
      (loop $wide
        (br_if $tail (i32.lt_u (i32.sub (global.get $end) (local.get $p)) (i32.const 16)))
        (local.set $w (v128.load (local.get $p)))
        (local.set $hits (v128.or
          (i8x16.eq (local.get $w) (i8x16.splat (i32.const 10)))
          (i8x16.eq (local.get $w) (i8x16.splat (i32.const 13)))))
        (local.set $hits (v128.or (local.get $hits) (v128.or
          (i8x16.eq (local.get $w) (i8x16.splat (i32.const "<")))
          (i8x16.eq (local.get $w) (i8x16.splat (i32.const "["))))))
        (local.set $hits (v128.or (local.get $hits) (v128.or
          (i8x16.eq (local.get $w) (i8x16.splat (i32.const "`")))
          (i8x16.eq (local.get $w) (i8x16.splat (i32.const 92))))))
        (local.set $hits (v128.or (local.get $hits) (v128.or
          (i8x16.eq (local.get $w) (i8x16.splat (i32.const "*")))
          (i8x16.eq (local.get $w) (i8x16.splat (i32.const "_"))))))
        (local.set $hits (v128.or (local.get $hits)
          (i8x16.eq (local.get $w) (i8x16.splat (i32.const "|")))))
        (local.set $mask (i8x16.bitmask (local.get $hits)))
        (if (local.get $mask)
          (then (return (i32.add (local.get $p) (i32.ctz (local.get $mask))))))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br $wide)))
    (block $done
      (loop $scalar
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $mask (i32.load8_u (local.get $p)))
        (br_if $done (byteset.get "\0a\0d*<[\5c_`|" (local.get $mask)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scalar)))
    (local.get $p))

  ;; End of one inline HTML construct starting at the `<` at $lhs, whose line
  ;; ends at $lineEnd. Returns lhs+1 when the byte after `<` rules a tag out,
  ;; and 0 when a tag could start but nothing closes it before the line end:
  ;; the caller then treats every later `<` on the line as plain text without
  ;; rescanning, which keeps a line of many `<` linear. Quoted attribute
  ;; values are bounded to the line too, so a tag never spans the chunk
  ;; boundary the line-fed engines cut at. A `<script` or `<style` open tag
  ;; extends through its matching close tag, or to $end, so the raw-text body
  ;; reaches the HTML lexer the same way whole-buffer and streamed.
  (func $markdownHtmlEnd (param $lhs i32) (param $lineEnd i32) (result i32)
    (local $p i32)
    (local $q i32)
    (local $c i32)
    (local $kind i32)
    (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
    (if (i32.ge_u (local.get $p) (global.get $end))
      (then (return (local.get $p))))
    (local.set $c (i32.load8_u (local.get $p)))
    (if (i32.eqz (i32.or
          (i32.eq (local.get $c) (i32.const "/"))
          (i32.or
            (i32.eq (local.get $c) (i32.const "!"))
            (i32.or
              (i32.eq (local.get $c) (i32.const "?"))
              (i32.or
                (call $lexIsIdentStart (local.get $c))
                (i32.eq (local.get $c) (i32.const ":")))))))
      (then (return (local.get $p))))
    ;; HTML comments need their real terminator, not the first `>`.
    (if (i32.and
          (i32.le_u (i32.add (local.get $lhs) (i32.const 4)) (global.get $end))
          (i32.eq (i32.load (local.get $lhs)) (i32.const "<!--")))
      (then
        ;; hop dash to dash with SIMD; a terminator must start with `-`
        (local.set $p (i32.add (local.get $lhs) (i32.const 4)))
        (block $commentDone
          (loop $comment
            (local.set $p (call $lexFindByte (local.get $p) (i32.const "-")))
            (br_if $commentDone (i32.ge_u (local.get $p) (global.get $end)))
            (if (i32.and
                  (i32.le_u (i32.add (local.get $p) (i32.const 3)) (global.get $end))
                  (i32.eq (i32.and (i32.load (local.get $p)) (i32.const 0xffffff))
                          (i32.const "-->")))
              (then (return (i32.add (local.get $p) (i32.const 3)))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $comment)))
        (return (global.get $end))))
    ;; no `>` left on the line: nothing at or after $p can close a tag
    (if (i32.ge_u
          (call $scanFindSpecial (local.get $p) (local.get $lineEnd)
            (i32.const ">") (i32.const 0) (i32.const 0))
          (local.get $lineEnd))
      (then (return (i32.const 0))))
    (block $closed
      (loop $l
        (if (i32.ge_u (local.get $p) (local.get $lineEnd))
          (then (return (i32.const 0))))
        (local.set $c (i32.load8_u (local.get $p)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br_if $closed (i32.eq (local.get $c) (i32.const ">")))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                    (i32.eq (local.get $c) (i32.const 39)))
          (then
            ;; hop to the closing quote with SIMD, bounded to the line
            (local.set $p (call $scanFindSpecial (local.get $p) (local.get $lineEnd)
              (local.get $c) (i32.const 0) (i32.const 0)))
            (if (i32.ge_u (local.get $p) (local.get $lineEnd))
              (then (return (i32.const 0))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))))
        (br $l)))
    ;; raw-text elements: run through the close tag the HTML lexer will stop at
    (if (call $lexIsIdentStart (i32.load8_u offset=1 (local.get $lhs)))
      (then
        (local.set $kind (call $rawTextKind
          (i32.add (local.get $lhs) (i32.const 1))
          (call $htmlNameEnd (i32.add (local.get $lhs) (i32.const 1)))))
        (if (local.get $kind)
          (then
            (local.set $q (local.get $p))
            (block $rawDone
              (loop $raw
                (local.set $q (call $lexFindByte (local.get $q) (i32.const "<")))
                (br_if $rawDone (i32.ge_u (local.get $q) (global.get $end)))
                (if (call $isRawTextClose (local.get $q) (local.get $kind))
                  (then
                    (local.set $q (call $lexFindByte (local.get $q) (i32.const ">")))
                    (if (i32.lt_u (local.get $q) (global.get $end))
                      (then (return (i32.add (local.get $q) (i32.const 1)))))
                    (return (global.get $end))))
                (local.set $q (i32.add (local.get $q) (i32.const 1)))
                (br $raw)))
            (return (global.get $end))))))
    (local.get $p))

  (func $markdownHtmlRange (param $from i32) (param $to i32)
    (local $save i32)
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (global.set $ptr (local.get $from))
    (call $hlHtml)
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $to)))

  (func $markdownYamlRange (param $from i32) (param $to i32)
    (local $save i32)
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (global.set $ptr (local.get $from))
    (call $hlYaml)
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $to)))

  (func $hlMarkdown
    (local $after i32)
    (local $body i32)
    (local $c i32)
    (local $close i32)
    (local $count i32)
    (local $fence i32)
    (local $fenceLen i32)
    (local $htmlEnd i32)
    (local $info i32)
    (local $lang i32)
    (local $lhs i32)
    ;; End of the line the cursor is on, computed lazily. Valid only while
    ;; $ptr stays below it; every user re-derives it once $ptr reaches or
    ;; passes it. Within one call $ptr only moves forward and $end is restored
    ;; around embedded ranges, so a value below the cache never crosses CR/LF.
    (local $lineCache i32)
    (local $lineEnd i32)
    (local $lineStart i32)
    ;; Failed-scan memos, each a position on the current line: no inline tag
    ;; closes before $htmlNoClose, and no `[..](..)` link can complete from a
    ;; `[` before $linkNoClose. Positions only grow, so a memo expires by
    ;; itself once the cursor passes it. They keep a line of many `<` or `[`
    ;; linear instead of rescanning to the line end per byte.
    (local $htmlNoClose i32)
    (local $linkNoClose i32)
    (local $p i32)
    (local $q i32)
    ;; block-quote markers seen on the current line; a fence opened behind
    ;; them closes only behind the same prefix
    (local $quotes i32)
    (call $lexEmitLeadingContinuation)
    ;; Each stream chunk is rewritten at the same base address, so a line-end
    ;; cache restored from an earlier chunk points into unrelated bytes and
    ;; may exceed the new $end. Start every call with the cache invalid.
    (local.set $lineCache (i32.const 0))
    (local.set $htmlNoClose (i32.const 0))
    (local.set $linkNoClose (i32.const 0))
    (local.set $quotes (i32.const 0))

    ;; YAML front matter is recognized only at the beginning of the source and
    ;; only when the opener occupies its own line. Every stream chunk starts
    ;; at $srcBase, so streaming also demands the first chunk: otherwise a
    ;; thematic break `---` mid-document would open front matter.
    (if (i32.and
          (i32.and
            (i32.eq (global.get $ptr) (global.get $srcBase))
            (i32.or (i32.eqz (global.get $streaming)) (global.get $streamReset)))
          (i32.and
            (i32.le_u (i32.add (global.get $ptr) (i32.const 3)) (global.get $end))
            (i32.eq (i32.and (i32.load (global.get $ptr)) (i32.const 0xffffff))
                    (i32.const "---"))))
      (then
        (local.set $lineEnd (call $markdownLineEnd (global.get $ptr)))
        (if (i32.eq (local.get $lineEnd) (i32.add (global.get $ptr) (i32.const 3)))
          (then
            (local.set $after (call $markdownAfterLine (local.get $lineEnd)))
            (call $emitTok (enum.get $Token.punctuation.special)
              (global.get $ptr) (local.get $after))
            (local.set $body (local.get $after))
            (local.set $p (local.get $body))
            (local.set $close (global.get $end))
            (block $frontDone
              (loop $front
                (br_if $frontDone (i32.ge_u (local.get $p) (global.get $end)))
                (local.set $lineEnd (call $markdownLineEnd (local.get $p)))
                (if (i32.and
                      (i32.eq (i32.sub (local.get $lineEnd) (local.get $p)) (i32.const 3))
                      (i32.eq (i32.and (i32.load (local.get $p)) (i32.const 0xffffff))
                              (i32.const "---")))
                  (then
                    (local.set $close (local.get $p))
                    (br $frontDone)))
                (local.set $p (call $markdownAfterLine (local.get $lineEnd)))
                (br $front)))
            (call $markdownYamlRange (local.get $body) (local.get $close))
            (if (i32.and
                  (global.get $streaming)
                  (i32.eq (local.get $close) (global.get $end)))
              (then
                (call $streamSetRegion (i32.const 4))
                (global.set $streamRegionStarted (i32.const 1)))
              (else
                (if (global.get $streaming)
                  (then (call $markdownClearEmbeddedStream)))))
            (if (i32.lt_u (local.get $close) (global.get $end))
              (then
                (global.set $ptr (local.get $close))
                (local.set $lineEnd (call $markdownLineEnd (global.get $ptr)))
                (local.set $after (call $markdownAfterLine (local.get $lineEnd)))
                (call $emitTok (enum.get $Token.punctuation.special)
                  (global.get $ptr) (local.get $after))
                (global.set $ptr (local.get $after))))))))

    (local.set $lineStart (i32.or
      (i32.eq (global.get $ptr) (global.get $srcBase))
      (i32.and
        (i32.gt_u (global.get $ptr) (global.get $srcBase))
        (i32.or
          (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 10))
          (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 13))))))

    (block $done
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))

        ;; Newline bytes are gaps and reset block-prefix recognition.
        (if (i32.or (i32.eq (local.get $c) (i32.const 10))
                    (i32.eq (local.get $c) (i32.const 13)))
          (then
            (global.set $ptr (call $markdownAfterLine (global.get $ptr)))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (local.set $lineStart (i32.const 1))
            (local.set $quotes (i32.const 0))
            (br $next)))

        ;; Up to three leading spaces retain line-start meaning.
        (if (i32.and (local.get $lineStart) (i32.eq (local.get $c) (i32.const 32)))
          (then
            (local.set $count (i32.const 0))
            (block $indentDone
              (loop $indent
                (br_if $indentDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (br_if $indentDone (i32.ne (i32.load8_u (global.get $ptr)) (i32.const 32)))
                (br_if $indentDone (i32.ge_u (local.get $count) (i32.const 3)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (local.set $count (i32.add (local.get $count) (i32.const 1)))
                (br $indent)))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; Block quote marker. Keeping line-start state accepts nested `> >`.
        (if (i32.and (local.get $lineStart) (i32.eq (local.get $c) (i32.const ">")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.markup)
              (local.get $lhs) (global.get $ptr))
            (local.set $quotes (i32.add (local.get $quotes) (i32.const 1)))
            (br $next)))

        ;; ATX heading.
        (if (i32.and (local.get $lineStart) (i32.eq (local.get $c) (i32.const "#")))
          (then
            (local.set $p (global.get $ptr))
            (block $hashDone
              (loop $hash
                (br_if $hashDone (i32.ge_u (local.get $p) (global.get $end)))
                (br_if $hashDone (i32.ne (i32.load8_u (local.get $p)) (i32.const "#")))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $hash)))
            (if (i32.and
                  (i32.le_u (i32.sub (local.get $p) (global.get $ptr)) (i32.const 6))
                  (i32.and
                    (i32.lt_u (local.get $p) (global.get $end))
                    (call $lexIsSpace (i32.load8_u (local.get $p)))))
              (then
                (call $emitTok (enum.get $Token.punctuation.special)
                  (global.get $ptr) (local.get $p))
                (global.set $ptr (local.get $p))
                (local.set $lineEnd (call $markdownLineEnd (global.get $ptr)))
                ;; The blanks after the marker are line-bounded: an empty
                ;; heading must not eat the newline and take the next line as
                ;; its title.
                (local.set $p (global.get $ptr))
                (block $blankDone
                  (loop $blank
                    (br_if $blankDone (i32.ge_u (global.get $ptr) (local.get $lineEnd)))
                    (br_if $blankDone
                      (i32.eqz (call $lexIsSpace (i32.load8_u (global.get $ptr)))))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $blank)))
                (call $emitGap (local.get $p) (global.get $ptr))
                (call $emitTok (enum.get $Token.title) (global.get $ptr) (local.get $lineEnd))
                (global.set $ptr (local.get $lineEnd))
                (local.set $lineStart (i32.const 0))
                (br $next)))))

        ;; Fenced code block. A supported info-string language delegates the
        ;; bounded body to its lexer; unknown languages remain text.literal.
        ;; A closing fence starts a line and is at least the opener's length.
        (if (i32.and
              (local.get $lineStart)
              (i32.or (i32.eq (local.get $c) (i32.const "`"))
                      (i32.eq (local.get $c) (i32.const "~"))))
          (then
            (local.set $fence (local.get $c))
            (local.set $p (global.get $ptr))
            (block $openRunDone
              (loop $openRun
                (br_if $openRunDone (i32.ge_u (local.get $p) (global.get $end)))
                (br_if $openRunDone (i32.ne (i32.load8_u (local.get $p)) (local.get $fence)))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $openRun)))
            (local.set $fenceLen (i32.sub (local.get $p) (global.get $ptr)))
            (if (i32.ge_u (local.get $fenceLen) (i32.const 3))
              (then
                (local.set $lineEnd (call $markdownLineEnd (global.get $ptr)))
                (local.set $q (local.get $p))
                (block $infoStart
                  (loop $infoSpace
                    (br_if $infoStart (i32.ge_u (local.get $q) (local.get $lineEnd)))
                    (br_if $infoStart (i32.eqz (call $lexIsSpace (i32.load8_u (local.get $q)))))
                    (local.set $q (i32.add (local.get $q) (i32.const 1)))
                    (br $infoSpace)))
                (local.set $info (local.get $q))
                (block $infoDone
                  (loop $infoWord
                    (br_if $infoDone (i32.ge_u (local.get $q) (local.get $lineEnd)))
                    (br_if $infoDone (call $lexIsSpace (i32.load8_u (local.get $q))))
                    (local.set $q (i32.add (local.get $q) (i32.const 1)))
                    (br $infoWord)))
                (local.set $lang (call $markdownFenceLang (local.get $info) (local.get $q)))
                (local.set $body (call $markdownAfterLine (local.get $lineEnd)))
                (call $emitTok (enum.get $Token.punctuation.delimiter)
                  (global.get $ptr) (local.get $body))
                (local.set $close (call $markdownFenceClose
                  (local.get $body) (local.get $fence) (local.get $fenceLen)
                  (local.get $quotes)))
                (if (local.get $lang)
                  (then
                    ;; a fence body is a fresh sub-document for the shared
                    ;; parameter-machine globals
                    (call $sigReset)
                    (call $markdownCodeRange
                      (local.get $lang) (local.get $body) (local.get $close)))
                  (else (call $emitTok
                    (enum.get $Token.text.literal) (local.get $body) (local.get $close))))
                (if (global.get $streaming)
                  (then
                    ;; the body's lexer may have checkpointed an open comment
                    ;; or region at the body end; only the fence itself
                    ;; carries over, so the next chunk resumes the fence
                    ;; rather than a construct cut off by it
                    (call $markdownClearEmbeddedStream)
                    (if (i32.eq (local.get $close) (global.get $end))
                      (then
                        ;; run length in the low half, block-quote depth above
                        (call $markdownFenceSet
                          (local.get $fence)
                          (i32.or
                            (select (i32.const 0xffff) (local.get $fenceLen)
                              (i32.gt_u (local.get $fenceLen) (i32.const 0xffff)))
                            (i32.shl
                              (select (i32.const 0x7fff) (local.get $quotes)
                                (i32.gt_u (local.get $quotes) (i32.const 0x7fff)))
                              (i32.const 16)))
                          (local.get $lang)))
                      ;; the block closed in this chunk, so fences its body
                      ;; left open at deeper depths are finished text
                      (else (call $markdownFenceClearDeeper)))))
                (global.set $ptr (local.get $close))
                (if (i32.lt_u (local.get $close) (global.get $end))
                  (then
                    (local.set $lineEnd (call $markdownLineEnd (global.get $ptr)))
                    (local.set $after (call $markdownAfterLine (local.get $lineEnd)))
                    (call $emitTok (enum.get $Token.punctuation.delimiter)
                      (global.get $ptr) (local.get $after))
                    (global.set $ptr (local.get $after))))
                (local.set $lineStart (i32.const 1))
                (br $next)))))

        ;; Unordered and ordered list markers.
        (if (local.get $lineStart)
          (then
            (local.set $p (global.get $ptr))
            (if (i32.or
                  (i32.eq (local.get $c) (i32.const "-"))
                  (i32.or (i32.eq (local.get $c) (i32.const "+"))
                          (i32.eq (local.get $c) (i32.const "*"))))
              (then (local.set $p (i32.add (local.get $p) (i32.const 1))))
              (else
                (if (call $lexIsDigit (local.get $c))
                  (then
                    (block $digitsDone
                      (loop $digits
                        (br_if $digitsDone (i32.ge_u (local.get $p) (global.get $end)))
                        (br_if $digitsDone (i32.eqz (call $lexIsDigit (i32.load8_u (local.get $p)))))
                        (local.set $p (i32.add (local.get $p) (i32.const 1)))
                        (br $digits)))
                    (if (i32.and
                          (i32.lt_u (local.get $p) (global.get $end))
                          (i32.or
                            (i32.eq (i32.load8_u (local.get $p)) (i32.const "."))
                            (i32.eq (i32.load8_u (local.get $p)) (i32.const ")"))))
                      (then (local.set $p (i32.add (local.get $p) (i32.const 1))))
                      (else (local.set $p (global.get $ptr))))))))
            (if (i32.and
                  (i32.gt_u (local.get $p) (global.get $ptr))
                  (i32.and
                    (i32.lt_u (local.get $p) (global.get $end))
                    (call $lexIsSpace (i32.load8_u (local.get $p)))))
              (then
                (global.set $ptr (local.get $p))
                (call $emitTok (enum.get $Token.punctuation.list_marker)
                  (local.get $lhs) (global.get $ptr))
                ;; the item content keeps line-start meaning: `- ```js` opens
                ;; a fence and `- # title` is a heading
                (br $next)))))

        (local.set $lineStart (i32.const 0))

        ;; Pipe-table punctuation. A lightweight lexer also accepts a lone pipe
        ;; as markup rather than buffering table state.
        (if (i32.eq (local.get $c) (i32.const "|"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.markup)
              (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; Inline HTML: give exactly one bounded construct to the HTML lexer.
        (if (i32.eq (local.get $c) (i32.const "<"))
          (then
            (if (i32.ge_u (global.get $ptr) (local.get $lineCache))
              (then (local.set $lineCache (call $markdownLineEnd (global.get $ptr)))))
            (if (i32.ge_u (global.get $ptr) (local.get $htmlNoClose))
              (then
                (local.set $htmlEnd (call $markdownHtmlEnd
                  (global.get $ptr) (local.get $lineCache)))
                (if (i32.eqz (local.get $htmlEnd))
                  (then (local.set $htmlNoClose (local.get $lineCache))))
                (if (i32.gt_u (local.get $htmlEnd) (i32.add (global.get $ptr) (i32.const 1)))
                  (then
                    (call $markdownHtmlRange (global.get $ptr) (local.get $htmlEnd))
                    ;; the HTML lexer checkpoints an open script/style body at
                    ;; its range end; that is only the chunk end when the
                    ;; range reaches $eof, otherwise markdown continues here
                    (if (i32.and
                          (global.get $streaming)
                          (i32.ne (local.get $htmlEnd) (global.get $eof)))
                      (then (call $markdownClearEmbeddedStream)))
                    (br $next)))))))

        ;; Inline code run. A missing closer consumes to the current line end.
        (if (i32.eq (local.get $c) (i32.const "`"))
          (then
            (local.set $p (global.get $ptr))
            (block $ticksDone
              (loop $ticks
                (br_if $ticksDone (i32.ge_u (local.get $p) (global.get $end)))
                (br_if $ticksDone (i32.ne (i32.load8_u (local.get $p)) (i32.const "`")))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $ticks)))
            (local.set $count (i32.sub (local.get $p) (global.get $ptr)))
            ;; the opener's backticks hold no CR/LF, so the cached line end
            ;; also bounds the scan that starts at $p
            (if (i32.ge_u (global.get $ptr) (local.get $lineCache))
              (then (local.set $lineCache (call $markdownLineEnd (global.get $ptr)))))
            (local.set $close (local.get $lineCache))
            (block $codeDone
              (loop $code
                ;; hop backtick to backtick with SIMD, bounded to the line
                (local.set $p (call $scanFindSpecial (local.get $p)
                  (local.get $lineCache) (i32.const "`") (i32.const 0) (i32.const 0)))
                (br_if $codeDone (i32.ge_u (local.get $p) (local.get $lineCache)))
                (local.set $q (local.get $p))
                (block $closeTicksDone
                  (loop $closeTicks
                    (br_if $closeTicksDone (i32.ge_u (local.get $q) (local.get $lineCache)))
                    (br_if $closeTicksDone (i32.ne (i32.load8_u (local.get $q)) (i32.const "`")))
                    (local.set $q (i32.add (local.get $q) (i32.const 1)))
                    (br $closeTicks)))
                (if (i32.eq (i32.sub (local.get $q) (local.get $p)) (local.get $count))
                  (then
                    (local.set $close (local.get $q))
                    (br $codeDone)))
                (local.set $p (local.get $q))
                (br $code)))
            (global.set $ptr (local.get $close))
            (call $emitTok (enum.get $Token.text.literal) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; `[label](uri)` links. A `[` whose `]` scan would start at or before
        ;; a memoised failure finds the same `]` again, or none: skip it.
        (if (i32.eq (local.get $c) (i32.const "["))
          (then
            (if (i32.ge_u (global.get $ptr) (local.get $lineCache))
              (then (local.set $lineCache (call $markdownLineEnd (global.get $ptr)))))
            (if (i32.gt_u (i32.add (global.get $ptr) (i32.const 1)) (local.get $linkNoClose))
              (then
                (local.set $p (call $scanFindSpecial
                  (i32.add (global.get $ptr) (i32.const 1)) (local.get $lineCache)
                  (i32.const "]") (i32.const 0) (i32.const 0)))
                (if (i32.and
                      (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $lineCache))
                      (i32.and
                        (i32.eq (i32.load8_u (local.get $p)) (i32.const "]"))
                        (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "("))))
                  (then
                    (local.set $q (call $scanFindSpecial
                      (i32.add (local.get $p) (i32.const 2)) (local.get $lineCache)
                      (i32.const ")") (i32.const 0) (i32.const 0)))
                    (if (i32.lt_u (local.get $q) (local.get $lineCache))
                      (then
                        (call $emitTok (enum.get $Token.punctuation.bracket)
                          (global.get $ptr) (i32.add (global.get $ptr) (i32.const 1)))
                        (call $emitTok (enum.get $Token.link_text)
                          (i32.add (global.get $ptr) (i32.const 1)) (local.get $p))
                        (call $emitTok (enum.get $Token.punctuation.bracket)
                          (local.get $p) (i32.add (local.get $p) (i32.const 2)))
                        (call $emitTok (enum.get $Token.link_uri)
                          (i32.add (local.get $p) (i32.const 2)) (local.get $q))
                        (call $emitTok (enum.get $Token.punctuation.bracket)
                          (local.get $q) (i32.add (local.get $q) (i32.const 1)))
                        (global.set $ptr (i32.add (local.get $q) (i32.const 1)))
                        (br $next)))
                    ;; no `)` from here to the line end: every later `[` on
                    ;; the line needs one further right and fails too
                    (local.set $linkNoClose (local.get $lineCache)))
                  (else
                    ;; `]` missing, or not followed by `(`: later `[` up to
                    ;; that `]` would find the same one
                    (local.set $linkNoClose (select
                      (local.get $lineCache) (local.get $p)
                      (i32.ge_u (local.get $p) (local.get $lineCache))))))))))

        ;; Strong/emphasis spans. Delimiters share the style with their text;
        ;; this keeps the hot path compact and matches Zed's visual result.
        (if (i32.or (i32.eq (local.get $c) (i32.const "*"))
                    (i32.eq (local.get $c) (i32.const "_")))
          (then
            (local.set $count (select (i32.const 2) (i32.const 1)
              (i32.and
                (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
                (i32.eq (i32.load8_u offset=1 (global.get $ptr)) (local.get $c)))))
            (if (i32.ge_u (global.get $ptr) (local.get $lineCache))
              (then (local.set $lineCache (call $markdownLineEnd (global.get $ptr)))))
            (local.set $p (i32.add (global.get $ptr) (local.get $count)))
            (local.set $close (i32.const 0))
            (block $emDone
              ;; `_` opens emphasis only when left-flanking: not glued to a
              ;; preceding alphanumeric byte and not followed by a blank, so
              ;; `snake_case_name` stays plain. The byte before the chunk
              ;; start is a line break, which never flanks.
              (br_if $emDone (i32.and
                (i32.eq (local.get $c) (i32.const "_"))
                (i32.or
                  (i32.and
                    (i32.gt_u (local.get $lhs) (global.get $srcBase))
                    (call $markdownIsAlnum
                      (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1)))))
                  (i32.or
                    (i32.ge_u (local.get $p) (local.get $lineCache))
                    (call $lexIsSpace (i32.load8_u (local.get $p)))))))
              (loop $em
                ;; hop marker to marker with SIMD, bounded to the line
                (local.set $p (call $scanFindSpecial (local.get $p)
                  (local.get $lineCache) (local.get $c) (i32.const 0) (i32.const 0)))
                (br_if $emDone (i32.ge_u (local.get $p) (local.get $lineCache)))
                (if (i32.eq (local.get $count) (i32.const 1))
                  (then
                    (local.set $close (i32.add (local.get $p) (i32.const 1)))
                    (br $emDone)))
                (if (i32.and
                      (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $lineCache))
                      (i32.eq (i32.load8_u offset=1 (local.get $p)) (local.get $c)))
                  (then
                    (local.set $close (i32.add (local.get $p) (i32.const 2)))
                    (br $emDone)))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $em)))
            (if (local.get $close)
              (then
                (global.set $ptr (local.get $close))
                (call $emitTok
                  (select (enum.get $Token.emphasis.strong) (enum.get $Token.emphasis)
                    (i32.eq (local.get $count) (i32.const 2)))
                  (local.get $lhs) (global.get $ptr))
                (br $next)))
            ;; a `_` run that did not open emphasis is plain text as a whole:
            ;; its later bytes must not open emphasis from inside the run, or
            ;; `a__b__` would pair the second `_` with `_b_`
            (if (i32.eq (local.get $c) (i32.const "_"))
              (then
                (block $runDone
                  (loop $run
                    (br_if $runDone (i32.ge_u (global.get $ptr) (global.get $end)))
                    (br_if $runDone
                      (i32.ne (i32.load8_u (global.get $ptr)) (i32.const "_")))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $run)))
                (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
                (br $next)))))

        ;; Backslash escape: only ASCII punctuation can be escaped. Any other
        ;; byte stays outside the token, so `\` before a line break is a hard
        ;; break and the next line keeps its line-start meaning.
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.and
                  (i32.lt_u (global.get $ptr) (global.get $end))
                  (call $markdownIsPunct (i32.load8_u (global.get $ptr))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.string.escape) (local.get $lhs) (global.get $ptr)))
              (else
                (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))))
            (br $next)))

        ;; Batch ordinary text up to the next potentially meaningful byte.
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (global.set $ptr (call $markdownPlainEnd (global.get $ptr)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
