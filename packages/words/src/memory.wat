(module
  (const $mem.numbuf 48)
  (const $mem.numbufEnd 64)
  (const $mem.hexdigits 64)
  (const $mem.strings 80)
  (const $mem.stringsEnd 1344)
  (const $mem.paragraphLo $mem.stringsEnd)
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
  ;; Block analysis owns [$mem.container, $mem.containerEnd): 250 × 24-byte
  ;; spine entries. Rendering reuses the first 1 KB as its type/tightness
  ;; stack and the rest as the inline opener bottoms, backtick memo, and
  ;; bracket stack, which are dead until the record stream is finished.
  (const $mem.container $mem.sgr+32)
  (const $mem.containerEnd $mem.container+6000)
  (const $mem.opener $mem.container+1024)
  (const $mem.tickMemo $mem.opener+128)
  (const $mem.bracket $mem.opener+1152)
  ;; Completion runs when block analysis is done and inline analysis has not
  ;; started, so its 64-entry delimiter (16 bytes each) and bracket (8 bytes)
  ;; stacks use this space too.
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
  ;; The Unicode range tables as the binary stores them. $unpackRanges expands
  ;; them into $mem.punct, $mem.width and $mem.wide at instantiation.
  (const $mem.packed $mem.itemIndent+256)
  (const $mem.packedEnd $mem.packed+2048)
  ;; The id prefix of formatted HTML, already escaped: the host writes it here
  ;; and its length in control bytes [28:30).
  (const $mem.idPrefix 61440)
  (const $mem.input 65536)
)
