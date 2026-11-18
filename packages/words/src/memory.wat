(module
  (;;
    memory structure
    [] page 1 (control block and static tables)
      [0]             render mode (u8): 0 = html, 1 = ansi
      [1]             option flags (u8): bit 0 = frontmatter, bit 1 = skip raw HTML,
                      bit 2 = repair a closed link label at the end of input,
                      bit 3 = session render: measure the boundary in UTF-16
                      and mark an open fence,
                      bit 4 = completion appended a pending link destination,
                      bit 5 = ansi input is bytes and may hold invalid UTF-8,
                      bit 6 = complete unfinished inline syntax,
                      bit 7 = completion changed the input (set by render)
      [2:6)           input length (u32 LE)
      [6:10)          output start (u32 LE)
      [10:14)         output length (u32 LE)
      [14:18)         frontmatter JSON start (u32 LE, 0 when absent)
      [18:22)         frontmatter JSON length (u32 LE)
      [22:26)         ansi wrap width (u32 LE, 0 = no wrapping)
      [26]            HTML format flags (u8, see $Fmt in format.wat); 0 = plain HTML
      [27]            output has a code block in slots (render sets, host clears)
      [28:30)         byte length of the id prefix at $mem.idPrefix (u16 LE)
      [30]            document contains global definitions
      [31]            extension flags (u8): bit 0 = CJK-friendly emphasis,
                      bit 1 = math
      [36:40)         UTF-16 length of the input before the boundary (option bit 3)
      [40:44)         UTF-16 length of the output before the boundary (option bit 3)
      [48:64)         decimal conversion scratch
      [64:80)         hex digits
      [80:65536)      static tables and work areas, in this order: CJK ranges,
                      scanner byte tables, HTML5 entities and index, P|S
                      ranges, case folding, block tag names and GFM tag
                      filter, display width ranges, ansi fragments and SGR
                      counters, container stack (reused by render and
                      completion), table column widths, ansi line prefix and
                      pending marker, ansi list state, packed range tables,
                      id prefix
    [] pages 2 to 4: math glyph metrics, TeX commands, math work areas,
       pooled output string literals, and math box nodes
    [] pages 5..N (text buffer)
      [$mem.input:EOF) input, a NUL sentinel, then at least 32 bytes of slack
      [meta:rec)      frontmatter JSON
      [rec:out)       block records, reference hash table, footnote order,
                      temporary ANSI table measurements
      [out:…)         rendered output
      [scratch:end)   rebuilt block content, inline marks
  ;;)
  (memory (export "memory") 5)

  (const $mem.numbuf 48)
  (const $mem.numbufEnd 64)
  (const $mem.hexdigits 64)
  ;; CJK ranges for the cjk option (see $isCjkCp)
  (const $mem.cjk 80)
  (const $mem.cjkEnd 1344)
  (const $mem.paragraphLo $mem.cjkEnd)
  (const $mem.crByte $mem.paragraphLo+16)
  (const $mem.quoteEscape $mem.crByte+1)
  (const $mem.lineEnds $mem.quoteEscape+8)
  (const $mem.lanePack $mem.lineEnds+16)
  (const $mem.blockStarts $mem.lanePack+16)
  (const $mem.markLo $mem.blockStarts+32)
  (const $mem.markHi $mem.markLo+16)
  (const $mem.syntaxLo $mem.markHi+16)
  (const $mem.escapeNibbles $mem.syntaxLo+16)
  (const $mem.entities $mem.escapeNibbles+16)
  (const $mem.entitiesEnd $mem.entities+34000)
  ;; 512 u16 displacement seeds, then 4096 packed u32 name/value records.
  (const $mem.entitySlots $mem.entities+1024)
  ;; Each name has a one-byte length before its bytes; slot pointers skip it.
  (const $mem.entityNames $mem.entitySlots+16384)
  (const $mem.punct $mem.entitiesEnd)
  (const $mem.punctEnd $mem.punct+1536)
  (const $mem.fold $mem.punctEnd)
  (const $mem.foldEnd $mem.fold+3328)
  (const $mem.blockTags $mem.foldEnd)
  (const $mem.blockTagsEnd $mem.blockTags+512)
  (const $mem.filterTags $mem.blockTagsEnd)
  (const $mem.filterTagsEnd $mem.filterTags+256)
  ;; zero-width ranges, then wide ones
  (const $mem.width $mem.filterTagsEnd)
  (const $mem.wide $mem.width+1664)
  (const $mem.widthEnd $mem.width+3328)
  (const $mem.quoteBar $mem.widthEnd)
  (const $mem.bullet $mem.quoteBar+19)
  ;; 16 spaces for indents, then byte constants ansi.wat splats (see its data)
  (const $mem.spaces $mem.bullet+12)
  (const $mem.sgr $mem.spaces+33)
  ;; 250 × 24-byte container entries. After block analysis, render reuses
  ;; the first 1 KB as its type/tightness stack, the rest for inline state.
  (const $mem.container $mem.sgr+32)
  (const $mem.containerEnd $mem.container+6000)
  (const $mem.opener $mem.container+1024)
  (const $mem.tickMemo $mem.opener+128)
  (const $mem.bracket $mem.opener+1152)
  ;; Completion runs between block and inline analysis, so its 64-entry
  ;; delimiter (16 bytes) and bracket (8 bytes) stacks share this space.
  (const $mem.completeDelims $mem.bracket)
  (const $mem.completeLinks $mem.completeDelims+1024)
  (const $mem.column $mem.containerEnd)
  (const $mem.columnEnd $mem.column+2048)
  (const $mem.prefix $mem.columnEnd)
  (const $mem.prefixEnd $mem.prefix+1024)
  (const $mem.pending $mem.prefixEnd-256)
  (const $mem.listNum $mem.prefixEnd)
  (const $mem.listKind $mem.listNum+1024)
  (const $mem.itemIndent $mem.listKind+256)
  ;; $unpackRanges expands these into $mem.punct, $mem.width, $mem.wide.
  (const $mem.packed $mem.itemIndent+256)
  (const $mem.packedEnd $mem.packed+2048)
  ;; Already escaped; written by the host.
  (const $mem.idPrefix 61440)
  ;; Math box nodes (pages 3-4) are 48 bytes each.
  (const $mem.mathGlyphs 65536)
  (const $mem.mathGlyphsEnd $mem.mathGlyphs+10240)
  (const $mem.mathCmds $mem.mathGlyphsEnd)
  (const $mem.mathCmdsEnd $mem.mathCmds+8192)
  (const $mem.mathSrc $mem.mathCmdsEnd)
  (const $mem.mathSrcEnd $mem.mathSrc+16384)
  (const $mem.mathAtoms $mem.mathSrcEnd)
  (const $mem.mathAtomsEnd $mem.mathAtoms+16384)
  (const $mem.mathCells $mem.mathAtomsEnd)
  (const $mem.mathCellsEnd $mem.mathCells+7936)
  ;; static strings and the environment names of math.wat
  (const $mem.mathStatic $mem.mathCellsEnd)
  ;; pooled output string literals
  (const $mem.strings $mem.mathStatic+1024)
  (const $mem.stringsEnd 131072)
  (const $mem.mathStaticEnd $mem.strings)
  (const $mem.mathNodes 131072)
  (const $mem.mathNodesEnd 262144)
  (const $mem.input 262144)
)
