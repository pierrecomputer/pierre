(module
  ;; Block analysis writes one flat record stream; rendering walks it once.
  ;; A record is
  ;;
  ;;   [0]  type (u8, $Blk)      [1]  flags (u8, $F)
  ;;   [2]  line-array offset (u16)
  ;;   [4]  size (u32, the whole record)
  ;;   [8]  data (u32)           [12] aux (u32)
  ;;   [16] nLines (u32), then type-specific bytes padded to eight
  ;;        (table alignments, link reference definition title and label)
  ;;   [..] nLines * {beg u32, end u32}
  ;;
  ;; `size` makes the stream walkable without knowing any type's layout, and
  ;; keeping the variable-length part *before* the lines means dropping
  ;; trailing lines never moves anything. A line's `end` carries the number of
  ;; virtual spaces a partially consumed tab left in front of it in its top two
  ;; bits, which limits the input to 1 GiB (the output would pass the wasm32
  ;; ceiling long before that).
  (const $R.header 24)
  (const $R.line 8)
  (const $R.nLines 16)     ;; u32: a paragraph can have more than 65535 lines
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
    "table"     ;; data = column count, extra = one alignment byte per column
    "linkdef"   ;; data/aux = destination; extra = title range, label length, label
    "footnote"  ;; container, data = assigned number; extra as for linkdef
  )

  ;; Record flags.
  (const $F.opener 1)
  (const $F.closer 2)
  (const $F.loose 4)
  (const $F.fenced 8)
  (const $F.task 16)
  (const $F.taskDone 32)
  (const $Nest 250)        ;; CommonMark container-nesting limit

  ;; Container stack entry (see $mem.container): 24 bytes so 250 levels fill
  ;; 6 KB and the same region can hold the inline opener/bracket state after
  ;; analysis finishes.
  (const $CS.size 24)
  (const $CS.type 0)
  (const $CS.ch 1)
  (const $CS.flags 2)
  (const $CS.indent 4)
  (const $CS.rec 8)
  (const $CS.line 12)
  (const $CS.children 16)

  ;; Container flags, and the masks that clear them.
  (const $C.lastLineBlank 1)
  (const $C.lastChildEndsBlank 2)
  (const $C.blankPending 4) ;; a block inside one of the list's items ended blank
  (const $C.loose 8)
  (const $C.clearLastLineBlank 254)
  (const $C.clearLastChildEndsBlank 253)

  ;; Table column alignment.
  (const $A.none 0)
  (const $A.left 1)
  (const $A.center 2)
  (const $A.right 3)
)
