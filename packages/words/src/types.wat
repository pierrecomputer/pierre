(module
  ;; Record layout:
  ;;
  ;;   [0]  type (u8, $Blk)      [1]  flags (u8, $F)
  ;;   [2]  line-array offset (u16)
  ;;   [4]  size (u32, the whole record)
  ;;   [8]  data (u32)           [12] aux (u32)
  ;;   [16] nLines (u32), then type-specific bytes padded to eight
  ;;        (table alignments, link reference definition title and label)
  ;;   [..] nLines * {beg u32, end u32}
  ;;
  ;; A line descriptor can cover several LF-separated source lines.
  ;; Paragraphs keep their last physical line for table conversion.
  ;; The top two bits of a code or HTML line's `end` hold the virtual spaces
  ;; left by a partly consumed tab. This limits input to 1 GiB. Other lines
  ;; have zero top bits.
  (const $R.header 24)
  (const $R.line 8)
  (const $R.nLines 16)     ;; u32 line/range count, not limited to 65535
  (const $R.defNext 20)    ;; link/footnote definition chain, in source order
  (const $R.labelLen 24)   ;; link and footnote definitions only
  (const $R.hash 28)
  (const $R.labelBytes 32)
  (const $R.endMask 1073741823)   ;; 0x3fffffff
  (const $R.padMask 3221225472)   ;; 0xc0000000

  (enum $Blk
    "none"      ;; a record the renderer skips
    "quote"     ;; container
    "ul"        ;; container, data = bullet character
    "ol"        ;; container, data = start number, aux = delimiter character
    "li"        ;; container
    "hr"
    "heading"   ;; data = level
    "code"      ;; data = info string begin, aux = info string end
    "html"
    "p"
    "table"     ;; data = column count, aux = previous table, extra = alignment bytes
    "linkdef"   ;; data/aux = destination; extra = title range, label length, label
    "footnote"  ;; container, data = assigned number; extra as for linkdef
  )

  ;; Warning: $F.math shares a bit with $F.task. Check the block type first:
  ;; $F.task is for list items, $F.math for code records.
  (const $F.opener 1)
  (const $F.closer 2)
  (const $F.loose 4)
  (const $F.fenced 8)
  (const $F.task 16)
  (const $F.math 16) ;; a code record from a `$$` fence
  (const $F.taskDone 32)
  (const $F.joinedLines 64) ;; a paragraph descriptor contains multiple physical lines
  (const $F.plainInline 128) ;; block scanning proved literal HTML content
  ;; opener and closer flags placed for $recNew's type argument
  (const $F.openerType 256)
  (const $F.closerType 512)
  (const $Nest 250)        ;; CommonMark container-nesting limit
  (const $MaxTableAutoCells 524288)

  ;; Container stack entry (see $mem.container)
  (const $CS.size 24)
  (const $CS.type 0)
  (const $CS.ch 1)
  (const $CS.flags 2)
  (const $CS.indent 4)
  (const $CS.rec 8)
  (const $CS.line 12)
  (const $CS.children 16)

  (const $C.lastLineBlank 1)
  (const $C.lastChildEndsBlank 2)
  (const $C.blankPending 4) ;; a block inside one of the list's items ended blank
  (const $C.loose 8)
  (const $C.clearLastLineBlank 254)
  (const $C.clearLastChildEndsBlank 253)

  (const $A.none 0)
  (const $A.left 1)
  (const $A.center 2)
  (const $A.right 3)
)
