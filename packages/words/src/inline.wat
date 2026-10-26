(module
  (import "./memory.wat")
  (import "./types.wat")
  (import "./scan.wat")
  (import "./out.wat")
  (import "./record.wat")
  (import "./htmlscan.wat")
  (import "./entity.wat")
  (import "./link.wat")
  (import "./extlink.wat")

  ;; Inline analysis runs over one contiguous content buffer and records every
  ;; construct it finds as a mark. Marks are kept in input order, so rendering
  ;; is a single merge walk of "text between marks" and "what each mark means".
  ;; Emphasis is resolved afterwards, over the delimiter marks only, exactly as
  ;; the spec's appendix describes.
  ;;
  ;; Marks are dense 32-byte records in input order. Four-byte emphasis tags
  ;; grow down from the top of scratch, so neither kind of record interrupts the
  ;; other. $M.prev and $M.data share a word: emphasis walks the delimiter list,
  ;; every other mark stores a payload. Everything is addressed by index or
  ;; offset, so scratch can move under us.
  (const $M.size 32)
  (const $M.beg 0)
  (const $M.end 4)
  (const $M.type 8)
  (const $M.flags 9)
  (const $M.ch 10)     ;; a delimiter run's character, or 1 for a numeric entity
  (const $M.aux 11)    ;; a named entity's replacement length
  (const $M.rem 12)    ;; delimiters of the run still unconsumed
  (const $M.prev 16)
  (const $M.data 16)   ;; code/entity/link/autolink payload (not live with $M.prev)
  (const $M.next 20)
  (const $M.openHead 24)
  (const $M.closeTail 28) ;; tail of the circular closing-tag list
  (const $B.size 12)   ;; bracket stack entry: mark, delimiter bottom, image/active/nested

  (enum $Mk
    "none"
    "bracket"    ;; an unresolved `[` or `![`
    "emph"       ;; a `*`, `_` or `~` delimiter run
    "code"       ;; data = content begin; the end derives from equal tick runs
    "autolink"   ;; data = 0 for a URI, 1 for an email address
    "rawhtml"
    "entity"
    "escape"
    "softbreak"
    "hardbreak"
    "linkopen"   ;; data = the closing mark
    "linkclose"  ;; link details occupy rem through closeTail
    "extlink"    ;; a GFM extended autolink; data = 0 verbatim, 1 http://, 2 mailto:
    "footnote"   ;; a GFM footnote reference; data = the definition record
  )

  ;; emphasis tag kinds
  (const $T.em 1)
  (const $T.strong 2)
  (const $T.del 3)
  (const $T.kindMask 3)
  (const $T.nextMask 4294967292)

  ;; mark flags
  (const $MF.canOpen 1)
  (const $MF.canClose 2)
  (const $MF.image 4)
  (const $MF.inList 8) ;; the mark is linked into the delimiter list
  (const $LF.hasTitle 8)
  (const $LF.pending 16) ;; a display-only link whose destination has not arrived

  ;; link details stored in otherwise unused fields of an Mk.linkclose mark
  (const $L.urlBeg $M.rem)
  (const $L.urlEnd $M.data)
  (const $L.titleBeg $M.next)
  (const $L.titleEnd $M.openHead)
  (const $L.def $M.closeTail)

  (global $markOff (mut i32) (i32.const 0))
  (global $nSlots (mut i32) (i32.const 0))
  (global $delimHead (mut i32) (i32.const -1))
  (global $delimTail (mut i32) (i32.const -1))
  (global $bracketSp (mut i32) (i32.const 0))
  (global $scannedBackticks (mut i32) (i32.const 0))
  (global $lastMarkEnd (mut i32) (i32.const 0))

  ;; the original length of a delimiter run, which the rule of three needs
  (func $markLen (param $m i32) (result i32)
    (i32.sub (i32.load offset=$M.end (local.get $m)) (i32.load offset=$M.beg (local.get $m))))

  (func $slotAt (param $i i32) (result i32)
    (i32.add (i32.add (global.get $scratchBase) (global.get $markOff))
      (i32.shl (local.get $i) (i32.const 5))))

  ;; A tag ID is its positive, four-byte-aligned distance from the memory top.
  ;; The low two bits of its word are the kind; the rest is the next tag ID.
  (func $tagAt (param $i i32) (result i32)
    (i32.sub (global.get $scratchTop) (local.get $i)))

  (func $markNew (param $type i32) (param $beg i32) (param $end i32) (result i32)
    (local $i i32)
    (local $m i32)
    (local.set $i (global.get $nSlots))
    (call $ensureScratch (i32.add (global.get $markOff)
      (i32.shl (i32.add (local.get $i) (i32.const 2)) (i32.const 5))))
    (global.set $nSlots (i32.add (local.get $i) (i32.const 1)))
    ;; The marks are part of the live scratch: a growing output moves all of them.
    (global.set $scratchUsed (i32.add (global.get $markOff)
      (i32.shl (global.get $nSlots) (i32.const 5))))
    (local.set $m (call $slotAt (local.get $i)))
    (i32.store offset=$M.beg (local.get $m) (local.get $beg))
    (i32.store offset=$M.end (local.get $m) (local.get $end))
    ;; Every field a mark can read is initialized here.
    (i64.store offset=$M.type (local.get $m) (i64.extend_i32_u (local.get $type)))
    (i64.store offset=$M.prev (local.get $m) (i64.const -1))
    (i64.store offset=$M.openHead (local.get $m) (i64.const 0))
    (global.set $lastMarkEnd (local.get $end))
    (local.get $i))

  (func $delimRemove (param $i i32)
    (local $m i32)
    (local $prev i32)
    (local $next i32)
    (local $flags i32)
    (local.set $m (call $slotAt (local.get $i)))
    (local.set $flags (i32.load8_u offset=$M.flags (local.get $m)))
    (if (i32.eqz (i32.and (local.get $flags) (i32.const $MF.inList)))
      (then (return)))
    (i32.store8 offset=$M.flags (local.get $m)
      (i32.and (local.get $flags) (i32.const 247)))
    (local.set $prev (i32.load offset=$M.prev (local.get $m)))
    (local.set $next (i32.load offset=$M.next (local.get $m)))
    (if (i32.ge_s (local.get $prev) (i32.const 0))
      (then (i32.store offset=$M.next (call $slotAt (local.get $prev)) (local.get $next)))
      (else (global.set $delimHead (local.get $next))))
    (if (i32.ge_s (local.get $next) (i32.const 0))
      (then (i32.store offset=$M.prev (call $slotAt (local.get $next)) (local.get $prev)))
      (else (global.set $delimTail (local.get $prev)))))

  (func $inlineScan
    (local $p i32)
    (local $end i32)
    (local $base i32)
    (local $c i32)
    (global.set $markOff (select
      (i32.const 0)
      (i32.and (i32.add (global.get $contentLen) (i32.const 63)) (i32.const -32))
      (i32.ne (global.get $contentBase) (global.get $scratchBase))))
    (global.set $scratchTailUsed (i32.const 0))
    (global.set $nSlots (i32.const 0))
    (global.set $delimHead (i32.const -1))
    (global.set $delimTail (i32.const -1))
    (global.set $bracketSp (i32.const 0))
    ;; The memo is read only after a scan has reached EOF. That scan overwrites
    ;; every run length relevant at any later position; stale absent lengths
    ;; can only cause another failed scan, so retaining them is safe.
    (global.set $scannedBackticks (i32.const 0))
    (global.set $lastMarkEnd (i32.const 0))
    (local.set $end (global.get $contentLen))
    (block $done
      (loop $l
        (local.set $base (call $contentAt (i32.const 0)))
        (local.set $p (i32.sub
          (call $findMark (i32.add (local.get $base) (local.get $p))
            (i32.add (local.get $base) (local.get $end)))
          (local.get $base)))
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $c (i32.load8_u (i32.add (local.get $base) (local.get $p))))
        (block $dispatched
          (if (i32.eq (local.get $c) (i32.const "\5c"))
            (then
              (local.set $p (call $handleBackslash (local.get $p) (local.get $end)))
              (br $dispatched)))
          (if (i32.eq (local.get $c) (i32.const "\60"))
            (then
              (local.set $p (call $handleBackticks (local.get $p) (local.get $end)))
              (br $dispatched)))
          (if (i32.eq (local.get $c) (i32.const 10))
            (then
              (local.set $p (call $handleNewline (local.get $p) (local.get $end)))
              (br $dispatched)))
          (if (i32.eq (local.get $c) (i32.const "&"))
            (then
              (local.set $p (call $handleEntity (local.get $p) (local.get $end)))
              (br $dispatched)))
          (if (i32.eq (local.get $c) (i32.const "<"))
            (then
              (local.set $p (call $handlePointy (local.get $p) (local.get $end)))
              (br $dispatched)))
          (if (i32.eq (local.get $c) (i32.const "["))
            (then
              (local.set $p (call $pushBracket (local.get $p) (i32.const 0)))
              (br $dispatched)))
          (if (i32.eq (local.get $c) (i32.const "!"))
            (then
              (if (i32.and (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $end))
                    (i32.eq (i32.load8_u
                      (i32.add (local.get $base) (i32.add (local.get $p) (i32.const 1))))
                      (i32.const "[")))
                (then (local.set $p (call $pushBracket (local.get $p) (i32.const 1))))
                (else (local.set $p (i32.add (local.get $p) (i32.const 1)))))
              (br $dispatched)))
          (if (i32.eq (local.get $c) (i32.const "]"))
            (then
              (local.set $p (call $handleCloseBracket (local.get $p) (local.get $end)))
              (br $dispatched)))
          (if (i32.eq (local.get $c) (i32.const ":"))
            (then
              (local.set $p (call $tryUrlAutolink (local.get $p) (local.get $end)))
              (br $dispatched)))
          (if (i32.eq (local.get $c) (i32.const "."))
            (then
              (local.set $p (call $tryWwwAutolink (local.get $p) (local.get $end)))
              (br $dispatched)))
          (if (i32.eq (local.get $c) (i32.const "@"))
            (then
              (local.set $p (call $tryEmailAutolink (local.get $p) (local.get $end)))
              (br $dispatched)))
          (local.set $p (call $handleDelim (local.get $p) (local.get $end))))
        (br $l)))
    (call $processEmphasis (i32.const 0) (i32.const -1)))

  (func $handleBackslash (param $p i32) (param $end i32) (result i32)
    (local $c i32)
    (local $base i32)
    (local.set $base (call $contentAt (i32.const 0)))
    (if (i32.ge_u (i32.add (local.get $p) (i32.const 1)) (local.get $end))
      (then (return (i32.add (local.get $p) (i32.const 1)))))
    (local.set $c (i32.load8_u (i32.add (local.get $base) (i32.add (local.get $p) (i32.const 1)))))
    (if (call $isAsciiPunct (local.get $c))
      (then
        (drop (call $markNew (enum.get $Mk.escape) (local.get $p) (i32.add (local.get $p) (i32.const 2))))
        (return (i32.add (local.get $p) (i32.const 2)))))
    (if (i32.eq (local.get $c) (i32.const 10))
      (then
        (drop (call $markNew (enum.get $Mk.hardbreak) (local.get $p)
          (i32.add (local.get $p) (i32.const 2))))
        (return (i32.add (local.get $p) (i32.const 2)))))
    (i32.add (local.get $p) (i32.const 1)))

  (func $handleNewline (param $p i32) (param $end i32) (result i32)
    (local $base i32)
    (local $q i32)
    (local $hard i32)
    (local.set $base (call $contentAt (i32.const 0)))
    (if (i32.ge_u (local.get $p) (i32.const 2))
      (then (local.set $hard (i32.and
        (i32.eq (i32.load8_u (i32.add (local.get $base) (i32.sub (local.get $p) (i32.const 1))))
          (i32.const 32))
        (i32.eq (i32.load8_u (i32.add (local.get $base) (i32.sub (local.get $p) (i32.const 2))))
          (i32.const 32))))))
    ;; leading spaces of the next line are never content
    (local.set $q (i32.sub
      (call $skipSpace (i32.add (local.get $base) (i32.add (local.get $p) (i32.const 1)))
        (i32.add (local.get $base) (local.get $end)))
      (local.get $base)))
    (drop (call $markNew
      (select (enum.get $Mk.hardbreak) (enum.get $Mk.softbreak) (local.get $hard))
      (local.get $p) (local.get $q)))
    (local.get $q))

  (func $handleEntity (param $p i32) (param $end i32) (result i32)
    (local $n i32)
    (local $base i32)
    (local $i i32)
    (local.set $base (call $contentAt (i32.const 0)))
    (local.set $n (call $entityMatch
      (i32.add (local.get $base) (local.get $p)) (i32.add (local.get $base) (local.get $end))))
    (if (i32.eqz (local.get $n)) (then (return (i32.add (local.get $p) (i32.const 1)))))
    (local.set $i (call $markNew (enum.get $Mk.entity)
      (local.get $p) (i32.add (local.get $p) (local.get $n))))
    ;; the replacement text lives in a static table, so it is safe to remember
    ;; a named reference points into the static table; a numeric one keeps its
    ;; code point, because the conversion scratch is reused by every mark
    (i32.store offset=$M.data (call $slotAt (local.get $i))
      (select (global.get $entCp) (global.get $entVal)
        (i32.ne (global.get $entCp) (i32.const -1))))
    (i32.store8 offset=$M.aux (call $slotAt (local.get $i)) (global.get $entLen))
    (i32.store8 offset=$M.ch (call $slotAt (local.get $i))
      (i32.ne (global.get $entCp) (i32.const -1)))
    (i32.add (local.get $p) (local.get $n)))

  (func $handlePointy (param $p i32) (param $end i32) (result i32)
    (local $base i32)
    (local $n i32)
    (local $i i32)
    (local.set $base (call $contentAt (i32.const 0)))
    (local.set $n (call $scanAutolinkUri (local.get $p) (local.get $end)))
    (if (local.get $n)
      (then
        (local.set $i (call $markNew (enum.get $Mk.autolink) (local.get $p) (local.get $n)))
        (i32.store offset=$M.data (call $slotAt (local.get $i)) (i32.const 0))
        (return (local.get $n))))
    (local.set $n (call $scanAutolinkEmail (local.get $p) (local.get $end)))
    (if (local.get $n)
      (then
        (local.set $i (call $markNew (enum.get $Mk.autolink) (local.get $p) (local.get $n)))
        (i32.store offset=$M.data (call $slotAt (local.get $i)) (i32.const 1))
        (return (local.get $n))))
    (local.set $n (call $scanHtmlAny
      (i32.add (local.get $base) (local.get $p)) (i32.add (local.get $base) (local.get $end))))
    (if (local.get $n)
      (then
        (drop (call $markNew (enum.get $Mk.rawhtml) (local.get $p)
          (i32.sub (local.get $n) (local.get $base))))
        (return (i32.sub (local.get $n) (local.get $base)))))
    (i32.add (local.get $p) (i32.const 1)))

  (func $handleBackticks (param $p i32) (param $end i32) (result i32)
    (local $base i32)
    (local $n i32)
    (local $q i32)
    (local $i i32)
    (local.set $base (call $contentAt (i32.const 0)))
    (local.set $q (local.get $p))
    (block $counted
      (loop $l
        (br_if $counted (i32.ge_u (local.get $q) (local.get $end)))
        (br_if $counted (i32.ne (i32.load8_u (i32.add (local.get $base) (local.get $q)))
          (i32.const "\60")))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (local.set $n (i32.add (local.get $n) (i32.const 1)))
        (br $l)))
    (local.set $i (call $scanToClosingBackticks (local.get $q) (local.get $end) (local.get $n)))
    (if (i32.eqz (local.get $i)) (then (return (local.get $q))))
    (local.set $q (call $markNew (enum.get $Mk.code) (local.get $p) (local.get $i)))
    (i32.store offset=$M.data (call $slotAt (local.get $q))
      (i32.add (local.get $p) (local.get $n)))
    (local.get $i))

  ;; the position just past a run of exactly $n backticks, or 0
  (func $scanToClosingBackticks (param $p i32) (param $end i32) (param $n i32) (result i32)
    (local $base i32)
    (local $ticks i32)
    (local $memo i32)
    (local.set $base (call $contentAt (i32.const 0)))
    (if (i32.gt_u (local.get $n) (i32.const 64)) (then (return (i32.const 0))))
    (local.set $memo (i32.add (i32.const $mem.tickMemo) (i32.mul (local.get $n) (i32.const 4))))
    (if (i32.and (global.get $scannedBackticks)
          (i32.le_u (i32.load (local.get $memo)) (local.get $p)))
      (then (return (i32.const 0))))
    (block $eof
      (loop $l
        (local.set $p (i32.sub
          (call $findByte (i32.add (local.get $base) (local.get $p))
            (i32.add (local.get $base) (local.get $end)) (i32.const "\60"))
          (local.get $base)))
        (br_if $eof (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $ticks (i32.const 0))
        (block $counted
          (loop $c
            (br_if $counted (i32.ge_u (local.get $p) (local.get $end)))
            (br_if $counted (i32.ne (i32.load8_u (i32.add (local.get $base) (local.get $p)))
              (i32.const "\60")))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (local.set $ticks (i32.add (local.get $ticks) (i32.const 1)))
            (br $c)))
        (if (i32.le_u (local.get $ticks) (i32.const 64))
          (then (i32.store
            (i32.add (i32.const $mem.tickMemo) (i32.mul (local.get $ticks) (i32.const 4)))
            (i32.sub (local.get $p) (local.get $ticks)))))
        (if (i32.eq (local.get $ticks) (local.get $n)) (then (return (local.get $p))))
        (br $l)))
    (global.set $scannedBackticks (i32.const 1))
    (i32.const 0))

  (func $handleDelim (param $p i32) (param $end i32) (result i32)
    (local $base i32)
    (local $c i32)
    (local $q i32)
    (local $n i32)
    (local $before i32)
    (local $after i32)
    (local $left i32)
    (local $right i32)
    (local $beforeWhite i32)
    (local $beforePunct i32)
    (local $afterWhite i32)
    (local $afterPunct i32)
    (local $canOpen i32)
    (local $canClose i32)
    (local $i i32)
    (local $m i32)
    (local $scan i32)
    (local.set $base (call $contentAt (i32.const 0)))
    (local.set $c (i32.load8_u (i32.add (local.get $base) (local.get $p))))
    (local.set $q (local.get $p))
    (block $counted
      (loop $l
        (br_if $counted (i32.ge_u (local.get $q) (local.get $end)))
        (br_if $counted (i32.ne (i32.load8_u (i32.add (local.get $base) (local.get $q)))
          (local.get $c)))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (local.set $n (i32.add (local.get $n) (i32.const 1)))
        (br $l)))
    ;; only runs of one or two tildes are strikethrough delimiters
    (if (i32.and (i32.eq (local.get $c) (i32.const "~")) (i32.gt_u (local.get $n) (i32.const 2)))
      (then (return (local.get $q))))
    (local.set $before
      (if (result i32) (i32.eqz (local.get $p))
        (then (i32.const 10))
        (else (if (result i32) (i32.eq (local.get $c) (i32.const "~"))
          (then
            (local.set $scan (local.get $p))
            (block $beforeDone
              (loop $beforeTilde
                (br_if $beforeDone (i32.eqz (local.get $scan)))
                (br_if $beforeDone (i32.ne
                  (i32.load8_u (i32.add (local.get $base)
                    (i32.sub (local.get $scan) (i32.const 1))))
                  (i32.const "~")))
                (local.set $scan (i32.sub (local.get $scan) (i32.const 1)))
                (br $beforeTilde)))
            (if (result i32) (i32.eqz (local.get $scan))
              (then (i32.const 10))
              (else (call $utf8Before
                (i32.add (local.get $base) (local.get $scan)) (local.get $base)))))
          (else (call $utf8Before
            (i32.add (local.get $base) (local.get $p)) (local.get $base)))))))
    (local.set $after
      (if (result i32) (i32.ge_u (local.get $q) (local.get $end))
        (then (i32.const 10))
        (else (if (result i32) (i32.eq (local.get $c) (i32.const "~"))
          (then
            (local.set $scan (local.get $q))
            (block $afterDone
              (loop $afterTilde
                (br_if $afterDone (i32.ge_u (local.get $scan) (local.get $end)))
                (br_if $afterDone (i32.ne
                  (i32.load8_u (i32.add (local.get $base) (local.get $scan)))
                  (i32.const "~")))
                (local.set $scan (i32.add (local.get $scan) (i32.const 1)))
                (br $afterTilde)))
            (if (result i32) (i32.ge_u (local.get $scan) (local.get $end))
              (then (i32.const 10))
              (else (call $utf8At
                (i32.add (local.get $base) (local.get $scan))
                (i32.add (local.get $base) (local.get $end))))))
          (else (call $utf8At
            (i32.add (local.get $base) (local.get $q))
            (i32.add (local.get $base) (local.get $end))))))))
    (local.set $beforeWhite (call $isWhiteCp (local.get $before)))
    (local.set $beforePunct (call $isPunctCp (local.get $before)))
    (local.set $afterWhite (call $isWhiteCp (local.get $after)))
    (local.set $afterPunct (call $isPunctCp (local.get $after)))
    (local.set $left (i32.and
      (i32.eqz (local.get $afterWhite))
      (i32.eqz (i32.and (local.get $afterPunct)
        (i32.and (i32.eqz (local.get $beforeWhite))
          (i32.eqz (local.get $beforePunct)))))))
    (local.set $right (i32.and
      (i32.eqz (local.get $beforeWhite))
      (i32.eqz (i32.and (local.get $beforePunct)
        (i32.and (i32.eqz (local.get $afterWhite))
          (i32.eqz (local.get $afterPunct)))))))
    (if (i32.eq (local.get $c) (i32.const "_"))
      (then
        (local.set $canOpen (i32.and (local.get $left)
          (i32.or (i32.eqz (local.get $right)) (local.get $beforePunct))))
        (local.set $canClose (i32.and (local.get $right)
          (i32.or (i32.eqz (local.get $left)) (local.get $afterPunct)))))
      (else
        (local.set $canOpen (local.get $left))
        (local.set $canClose (local.get $right))))
    (if (i32.eqz (i32.or (local.get $canOpen) (local.get $canClose)))
      (then (return (local.get $q))))
    (local.set $i (call $markNew (enum.get $Mk.emph) (local.get $p) (local.get $q)))
    (local.set $m (call $slotAt (local.get $i)))
    (i32.store offset=$M.rem (local.get $m) (local.get $n))
    (i32.store8 offset=$M.ch (local.get $m) (local.get $c))
    (i32.store8 offset=$M.flags (local.get $m) (i32.or
      (i32.or (select (i32.const $MF.canOpen) (i32.const 0) (local.get $canOpen))
        (i32.const $MF.inList))
      (select (i32.const $MF.canClose) (i32.const 0) (local.get $canClose))))
    (i32.store offset=$M.prev (local.get $m) (global.get $delimTail))
    (if (i32.ge_s (global.get $delimTail) (i32.const 0))
      (then (i32.store offset=$M.next (call $slotAt (global.get $delimTail)) (local.get $i)))
      (else (global.set $delimHead (local.get $i))))
    (global.set $delimTail (local.get $i))
    (local.get $q))

  (func $processEmphasis (param $bottom i32) (param $delimBottom i32)
    (local $closer i32)
    (local $opener i32)
    (local $found i32)
    (local $old i32)
    (local $idx i32)
    (local $cm i32)
    (local $om i32)
    (local $i i32)
    (local $ch i32)
    (local $flags i32)
    (local $openerFlags i32)
    (local $closerLen i32)
    (local $bottom4 v128)
    (local.set $closer
      (if (result i32) (i32.ge_s (local.get $delimBottom) (i32.const 0))
        (then (i32.load offset=$M.next (call $slotAt (local.get $delimBottom))))
        (else (global.get $delimHead))))
    ;; There is nothing to resolve or clear when every delimiter precedes the
    ;; bottom. Initialize four opener entries per iteration only when needed.
    (if (i32.lt_s (local.get $closer) (i32.const 0)) (then (return)))
    (local.set $bottom4 (i32x4.splat (local.get $bottom)))
    (local.set $i (i32.const 0))
    (loop $init
      (v128.store (i32.add (i32.const $mem.opener) (local.get $i)) (local.get $bottom4))
      (local.set $i (i32.add (local.get $i) (i32.const 16)))
      (br_if $init (i32.lt_u (local.get $i) (i32.const 80))))
    (block $done
      (loop $walk
        (br_if $done (i32.lt_s (local.get $closer) (i32.const 0)))
        (local.set $cm (call $slotAt (local.get $closer)))
        (local.set $flags (i32.load8_u offset=$M.flags (local.get $cm)))
        (if (i32.eqz (i32.and (local.get $flags) (i32.const $MF.canClose)))
          (then
            (local.set $closer (i32.load offset=$M.next (local.get $cm)))
            (br $walk)))
        (local.set $ch (i32.load8_u offset=$M.ch (local.get $cm)))
        (local.set $closerLen (call $markLen (local.get $cm)))
        (local.set $idx (i32.add
          (i32.mul
            (select (i32.const 0) (select (i32.const 1) (i32.const 2)
              (i32.eq (local.get $ch) (i32.const "_")))
              (i32.eq (local.get $ch) (i32.const "*")))
            (i32.const 6))
          (i32.add
            (select (i32.const 3) (i32.const 0)
              (i32.and (local.get $flags) (i32.const $MF.canOpen)))
            (i32.rem_u (local.get $closerLen) (i32.const 3)))))
        (local.set $opener (i32.load offset=$M.prev (local.get $cm)))
        (local.set $found (i32.const 0))
        (block $search
          (loop $back
            (br_if $search (i32.lt_s (local.get $opener) (i32.const 0)))
            (local.set $om (call $slotAt (local.get $opener)))
            (br_if $search (i32.lt_u (i32.load offset=$M.beg (local.get $om))
              (i32.load (i32.add (i32.const $mem.opener) (i32.mul (local.get $idx) (i32.const 4))))))
            (local.set $openerFlags (i32.load8_u offset=$M.flags (local.get $om)))
            (if (i32.and
                  (i32.and (local.get $openerFlags) (i32.const $MF.canOpen))
                  (i32.eq (i32.load8_u offset=$M.ch (local.get $om)) (local.get $ch)))
              (then
                (if (i32.or
                      (i32.or
                        (i32.eqz (i32.or
                          (i32.and (local.get $flags) (i32.const $MF.canOpen))
                          (i32.and (local.get $openerFlags) (i32.const $MF.canClose))))
                        (i32.eqz (i32.rem_u (local.get $closerLen) (i32.const 3))))
                      (i32.ne (i32.rem_u (i32.add
                        (call $markLen (local.get $om))
                        (local.get $closerLen)) (i32.const 3)) (i32.const 0)))
                  (then
                    (local.set $found (i32.const 1))
                    (br $search)))))
            (local.set $opener (i32.load offset=$M.prev (local.get $om)))
            (br $back)))
        (local.set $old (local.get $closer))
        (if (local.get $found)
          (then (local.set $closer (call $insertEmph (local.get $opener) (local.get $closer))))
          (else
            (local.set $closer (i32.load offset=$M.next (local.get $cm)))
            (i32.store (i32.add (i32.const $mem.opener) (i32.mul (local.get $idx) (i32.const 4)))
              (i32.load offset=$M.beg (local.get $cm)))
            (if (i32.eqz (i32.and (local.get $flags) (i32.const $MF.canOpen)))
              (then (call $delimRemove (local.get $old))))))
        (br $walk)))
    ;; drop every delimiter at or above the bottom
    (block $cleared
      (loop $l
        (br_if $cleared (i32.lt_s (global.get $delimTail) (i32.const 0)))
        (br_if $cleared (i32.lt_u
          (i32.load offset=$M.beg (call $slotAt (global.get $delimTail))) (local.get $bottom)))
        (call $delimRemove (global.get $delimTail))
        (br $l))))

  ;; Add one opening and one closing tag for an emphasis match. Reserving and
  ;; allocating the pair together avoids a second scratch-capacity check.
  (func $tagPair (param $opener i32) (param $closer i32) (param $kind i32)
    (local $openTag i32)
    (local $closeTag i32)
    (local $m i32)
    (local $tail i32)
    (local $head i32)
    (local $word i32)
    (call $ensureScratch (i32.add (global.get $scratchUsed) (i32.const 8)))
    (local.set $openTag (i32.add (global.get $scratchTailUsed) (i32.const 4)))
    (local.set $closeTag (i32.add (local.get $openTag) (i32.const 4)))
    (global.set $scratchTailUsed (local.get $closeTag))
    (local.set $m (call $slotAt (local.get $opener)))
    (i32.store (call $tagAt (local.get $openTag)) (i32.or
      (i32.load offset=$M.openHead (local.get $m)) (local.get $kind)))
    (i32.store offset=$M.openHead (local.get $m) (local.get $openTag))
    (local.set $m (call $slotAt (local.get $closer)))
    (local.set $tail
      (i32.load offset=$M.closeTail (local.get $m)))
    (if (local.get $tail)
      (then
        (local.set $word (i32.load (call $tagAt (local.get $tail))))
        (local.set $head (i32.and (local.get $word) (i32.const $T.nextMask))))
      (else (local.set $head (local.get $closeTag))))
    (i32.store (call $tagAt (local.get $closeTag))
      (i32.or (local.get $head) (local.get $kind)))
    (if (local.get $tail)
      (then (i32.store (call $tagAt (local.get $tail))
        (i32.or
          (i32.and (local.get $word) (i32.const $T.kindMask))
          (local.get $closeTag)))))
    (i32.store offset=$M.closeTail (local.get $m) (local.get $closeTag)))

  (func $insertEmph (param $opener i32) (param $closer i32) (result i32)
    (local $om i32)
    (local $cm i32)
    (local $use i32)
    (local $tmp i32)
    (local $next i32)
    (local $openerRem i32)
    (local $closerRem i32)
    (local.set $om (call $slotAt (local.get $opener)))
    (local.set $cm (call $slotAt (local.get $closer)))
    (local.set $openerRem (i32.load offset=$M.rem (local.get $om)))
    (local.set $closerRem (i32.load offset=$M.rem (local.get $cm)))
    ;; strikethrough consumes both runs at once, and only when they match
    (if (i32.eq (i32.load8_u offset=$M.ch (local.get $cm)) (i32.const "~"))
      (then
        (local.set $next (i32.load offset=$M.next (local.get $cm)))
        (if (i32.eq (local.get $openerRem) (local.get $closerRem))
          (then
            (call $tagPair (local.get $opener) (local.get $closer) (i32.const $T.del))
            (local.set $om (call $slotAt (local.get $opener)))
            (local.set $cm (call $slotAt (local.get $closer)))
            (i32.store offset=$M.rem (local.get $om) (i32.const 0))
            (i32.store offset=$M.rem (local.get $cm) (i32.const 0))))
        ;; either way both delimiters and everything between them are done
        (local.set $tmp (i32.load offset=$M.next (call $slotAt (local.get $opener))))
        (block $cleared
          (loop $l
            (br_if $cleared (i32.lt_s (local.get $tmp) (i32.const 0)))
            (br_if $cleared (i32.eq (local.get $tmp) (local.get $closer)))
            (local.set $om (i32.load offset=$M.next (call $slotAt (local.get $tmp))))
            (call $delimRemove (local.get $tmp))
            (local.set $tmp (local.get $om))
            (br $l)))
        (call $delimRemove (local.get $opener))
        (call $delimRemove (local.get $closer))
        (return (local.get $next))))
    (local.set $use (select (i32.const 2) (i32.const 1) (i32.and
      (i32.ge_u (local.get $openerRem) (i32.const 2))
      (i32.ge_u (local.get $closerRem) (i32.const 2)))))
    (local.set $openerRem (i32.sub (local.get $openerRem) (local.get $use)))
    (local.set $closerRem (i32.sub (local.get $closerRem) (local.get $use)))
    (i32.store offset=$M.rem (local.get $om) (local.get $openerRem))
    (i32.store offset=$M.rem (local.get $cm) (local.get $closerRem))
    ;; delimiters between the pair can never match anything now
    (local.set $tmp (i32.load offset=$M.next (local.get $om)))
    (block $cleared
      (loop $l
        (br_if $cleared (i32.lt_s (local.get $tmp) (i32.const 0)))
        (br_if $cleared (i32.eq (local.get $tmp) (local.get $closer)))
        (local.set $next (i32.load offset=$M.next (call $slotAt (local.get $tmp))))
        (call $delimRemove (local.get $tmp))
        (local.set $tmp (local.get $next))
        (br $l)))
    (local.set $tmp
      (select (i32.const $T.em) (i32.const $T.strong) (i32.eq (local.get $use) (i32.const 1))))
    (call $tagPair (local.get $opener) (local.get $closer) (local.get $tmp))
    (if (i32.eqz (local.get $openerRem))
      (then (call $delimRemove (local.get $opener))))
    (if (i32.eqz (local.get $closerRem))
      (then
        (local.set $cm (call $slotAt (local.get $closer)))
        (local.set $next (i32.load offset=$M.next (local.get $cm)))
        (call $delimRemove (local.get $closer))
        (return (local.get $next))))
    (local.get $closer))

  (func $bracketAt (param $i i32) (result i32)
    (i32.add (i32.const $mem.bracket) (i32.mul (local.get $i) (i32.const $B.size))))

  (func $pushBracket (param $p i32) (param $image i32) (result i32)
    (local $i i32)
    (local $b i32)
    (local $end i32)
    (local.set $end (i32.add (local.get $p) (i32.add (local.get $image) (i32.const 1))))
    (local.set $i (call $markNew (enum.get $Mk.bracket) (local.get $p) (local.get $end)))
    (if (local.get $image)
      (then (i32.store8 offset=$M.flags (call $slotAt (local.get $i)) (i32.const $MF.image))))
    (if (i32.ge_u (global.get $bracketSp) (i32.const 255)) (then (return (local.get $end))))
    (if (global.get $bracketSp)
      (then (i32.store8 offset=10
        (call $bracketAt (i32.sub (global.get $bracketSp) (i32.const 1))) (i32.const 1))))
    (local.set $b (call $bracketAt (global.get $bracketSp)))
    (i32.store (local.get $b) (local.get $i))
    (i32.store offset=4 (local.get $b) (global.get $delimTail))
    (i32.store offset=8 (local.get $b) (i32.or (local.get $image) (i32.const 0x100)))
    (global.set $bracketSp (i32.add (global.get $bracketSp) (i32.const 1)))
    (local.get $end))

  (func $handleCloseBracket (param $p i32) (param $end i32) (result i32)
    (local $base i32)
    (local $b i32)
    (local $initial i32)
    (local $q i32)
    (local $image i32)
    (local $matched i32)
    (local $urlB i32)
    (local $urlE i32)
    (local $titleB i32)
    (local $titleE i32)
    (local $hasTitle i32)
    (local $def i32)
    (local $rawB i32)
    (local $rawE i32)
    (local $found i32)
    (local $t i32)
    (local $starttitle i32)
    (local $endtitle i32)
    (local $open i32)
    (local $close i32)
    (local $n i32)
    (local $angle i32)
    (local $bottom i32)
    (local $delimBottom i32)
    (local $pending i32)
    (local.set $initial (i32.add (local.get $p) (i32.const 1)))
    (if (i32.eqz (global.get $bracketSp)) (then (return (local.get $initial))))
    (local.set $b (call $bracketAt (i32.sub (global.get $bracketSp) (i32.const 1))))
    (local.set $image (i32.load8_u offset=8 (local.get $b)))
    (local.set $bottom
      (i32.load offset=$M.end (call $slotAt (i32.load (local.get $b)))))
    (local.set $delimBottom (i32.load offset=4 (local.get $b)))
    (if (i32.eqz (i32.load8_u offset=9 (local.get $b)))
      (then
        (global.set $bracketSp (i32.sub (global.get $bracketSp) (i32.const 1)))
        (return (local.get $initial))))
    (local.set $base (call $contentAt (i32.const 0)))
    (local.set $q (local.get $initial))
    ;; a GFM footnote reference
    (if (i32.and (i32.eqz (local.get $image))
          (i32.and
            (i32.gt_u (local.get $p) (local.get $bottom))
            (i32.eq (i32.load8_u (i32.add (local.get $base) (local.get $bottom)))
              (i32.const "^"))))
      (then
        (local.set $def (call $lookupLabel
          (i32.add (local.get $bottom) (i32.const 1)) (local.get $p) (i32.const 1)))
        (if (local.get $def)
          (then
            (i32.store8 offset=$M.type (call $slotAt (i32.load (local.get $b)))
              (enum.get $Mk.footnote))
            (i32.store offset=$M.end (call $slotAt (i32.load (local.get $b))) (local.get $initial))
            (i32.store offset=$M.data (call $slotAt (i32.load (local.get $b))) (local.get $def))
            (call $processEmphasis (local.get $bottom) (local.get $delimBottom))
            (global.set $bracketSp (i32.sub (global.get $bracketSp) (i32.const 1)))
            (return (local.get $initial))))
        (local.set $def (i32.const 0))))
    (local.set $base (call $contentAt (i32.const 0)))
    ;; an inline link or image
    (if (i32.and (i32.lt_u (local.get $q) (local.get $end))
          (i32.eq (i32.load8_u (i32.add (local.get $base) (local.get $q))) (i32.const "(")))
      (then
        (local.set $t (call $skipWhite (i32.add (local.get $q) (i32.const 1)) (local.get $end)))
        (local.set $n (call $scanLinkDest
          (i32.add (local.get $base) (local.get $t)) (i32.add (local.get $base) (local.get $end))))
        (if (i32.ge_s (local.get $n) (i32.const 0))
          (then
            (local.set $angle (i32.eq
              (i32.load8_u (i32.add (local.get $base) (local.get $t))) (i32.const "<")))
            (local.set $urlB (i32.add (local.get $t) (local.get $angle)))
            (local.set $urlE (i32.sub
              (i32.sub (local.get $n) (local.get $base)) (local.get $angle)))
            (local.set $endtitle (i32.sub (local.get $n) (local.get $base)))
            (local.set $starttitle (call $skipWhite (local.get $endtitle) (local.get $end)))
            (if (i32.ne (local.get $starttitle) (local.get $endtitle))
              (then
                (local.set $t (call $scanLinkTitle
                  (i32.add (local.get $base) (local.get $starttitle))
                  (i32.add (local.get $base) (local.get $end))))
                (if (local.get $t)
                  (then
                    (local.set $hasTitle (i32.const 1))
                    (local.set $titleB (i32.add (local.get $starttitle) (i32.const 1)))
                    (local.set $titleE (i32.sub
                      (i32.sub (local.get $t) (local.get $base)) (i32.const 1)))
                    (local.set $endtitle (i32.sub (local.get $t) (local.get $base)))))))
            (local.set $t (call $skipWhite (local.get $endtitle) (local.get $end)))
            (if (i32.and (i32.lt_u (local.get $t) (local.get $end))
                  (i32.eq (i32.load8_u (i32.add (local.get $base) (local.get $t))) (i32.const ")")))
              (then
                (local.set $q (i32.add (local.get $t) (i32.const 1)))
                (local.set $matched (i32.const 1)))
              (else
                (local.set $hasTitle (i32.const 0))
                (local.set $q (local.get $initial))))))))
    ;; a reference link or image
    (if (i32.eqz (local.get $matched))
      (then
        (local.set $t (call $scanLinkLabel
          (i32.add (local.get $base) (local.get $q)) (i32.add (local.get $base) (local.get $end))))
        (if (local.get $t)
          (then
            (local.set $found (i32.const 1))
            (local.set $rawB (i32.add (local.get $q) (i32.const 1)))
            (local.set $rawE (i32.sub
              (i32.sub (local.get $t) (local.get $base)) (i32.const 1)))
            (local.set $q (i32.sub (local.get $t) (local.get $base))))
          (else (local.set $q (local.get $initial))))
        ;; a collapsed or shortcut reference uses the link text as its label
        (if (i32.and
              (i32.or (i32.eqz (local.get $found)) (i32.eq (local.get $rawE) (local.get $rawB)))
              (i32.eqz (i32.load8_u offset=10 (local.get $b))))
          (then
            (local.set $rawB (local.get $bottom))
            (local.set $rawE (local.get $p))
            (local.set $found (i32.const 1))))
        (if (local.get $found)
          (then (local.set $def
            (call $lookupLabel (local.get $rawB) (local.get $rawE) (i32.const 0)))))
        (if (local.get $def) (then (local.set $matched (i32.const 1))))))
    ;; Repair only the original document's trailing label, after real
    ;; references have failed. Code blocks and definition destinations never
    ;; reach this inline path; rebuilt nested content retains its source end.
    (if (i32.and (i32.eqz (local.get $matched))
          (i32.and (i32.eqz (local.get $image))
            (i32.and (i32.ne (i32.and (i32.load8_u (i32.const 1)) (i32.const 4)) (i32.const 0))
              (i32.and (i32.eq (global.get $contentInputEnd) (global.get $eof))
                (i32.eq (local.get $initial)
                  (i32.sub (global.get $contentLen)
                    (i32.sub (global.get $eof) (global.get $completeClosedLabelEnd))))))))
      (then
        (local.set $q (local.get $initial))
        (local.set $pending (i32.const 1))
        (local.set $matched (i32.const 1))))
    (if (i32.eqz (local.get $matched))
      (then
        (global.set $bracketSp (i32.sub (global.get $bracketSp) (i32.const 1)))
        (return (local.get $initial))))
    (local.set $open (i32.load (local.get $b)))
    (local.set $close (call $markNew (enum.get $Mk.linkclose) (local.get $p) (local.get $q)))
    (local.set $open (call $slotAt (local.get $open)))
    (i32.store8 offset=$M.type (local.get $open) (enum.get $Mk.linkopen))
    (i32.store offset=$M.data (local.get $open) (local.get $close))
    (local.set $close (call $slotAt (local.get $close)))
    (i32.store offset=$L.urlBeg (local.get $close) (local.get $urlB))
    (i32.store offset=$L.urlEnd (local.get $close) (local.get $urlE))
    (i32.store offset=$L.titleBeg (local.get $close) (local.get $titleB))
    (i32.store offset=$L.titleEnd (local.get $close) (local.get $titleE))
    (i32.store offset=$L.def (local.get $close) (local.get $def))
    (i32.store8 offset=$M.flags (local.get $close) (i32.or
      (select (i32.const $LF.pending) (i32.const 0) (local.get $pending))
      (i32.or
        (select (i32.const $LF.hasTitle) (i32.const 0) (local.get $hasTitle))
        (select (i32.const $MF.image) (i32.const 0) (local.get $image)))))
    (call $processEmphasis (local.get $bottom) (local.get $delimBottom))
    (global.set $bracketSp (i32.sub (global.get $bracketSp) (i32.const 1)))
    ;; a link may not contain another link: every bracket still open below this
    ;; one can no longer become one
    (if (i32.eqz (local.get $image))
      (then
        (local.set $n (i32.const 0))
        (block $done
          (loop $l
            (br_if $done (i32.ge_u (local.get $n) (global.get $bracketSp)))
            (if (i32.eqz (i32.load8_u offset=8 (call $bracketAt (local.get $n))))
              (then (i32.store8 offset=9 (call $bracketAt (local.get $n)) (i32.const 0))))
            (local.set $n (i32.add (local.get $n) (i32.const 1)))
            (br $l)))))
    (local.get $q))

  ;; normalize [$b,$e) of the content buffer and look it up in the reference map.
  ;; A footnote label is prefixed so the two namespaces never collide.
  (func $lookupLabel (param $b i32) (param $e i32) (param $footnote i32) (result i32)
    (local $tmp i32)
    (local $len i32)
    (local $normalized i64)
    (if (i32.ge_u (local.get $b) (local.get $e)) (then (return (i32.const 0))))
    (call $ensureScratch (i32.add
      (i32.add (global.get $markOff) (i32.mul (i32.add (global.get $nSlots) (i32.const 2))
        (i32.const $M.size)))
      (i32.add (i32.mul (i32.sub (local.get $e) (local.get $b)) (i32.const 3)) (i32.const 64))))
    (local.set $tmp (i32.add (i32.add (global.get $scratchBase) (global.get $markOff))
      (i32.mul (i32.add (global.get $nSlots) (i32.const 1)) (i32.const $M.size))))
    (local.set $normalized (call $normalizeLabel
      (call $contentAt (local.get $b))
      (call $contentAt (local.get $e))
      (local.get $tmp) (local.get $footnote)))
    (local.set $len (i32.wrap_i64 (local.get $normalized)))
    (call $linkLookup (local.get $tmp) (local.get $len)
      (i32.wrap_i64 (i64.shr_u (local.get $normalized) (i64.const 32)))
      (select (enum.get $Blk.footnote) (enum.get $Blk.linkdef) (local.get $footnote))))

  ;; spaces, tabs and line endings, as offsets into the content buffer
  (func $skipWhite (param $p i32) (param $end i32) (result i32)
    (local $base i32)
    (local.set $base (call $contentAt (i32.const 0)))
    (i32.sub
      (call $skipWs (i32.add (local.get $base) (local.get $p))
        (i32.add (local.get $base) (local.get $end)))
      (local.get $base)))

  ;; `<scheme:...>`; returns the offset just past `>`, or 0
  (func $scanAutolinkUri (param $p i32) (param $end i32) (result i32)
    (local $base i32)
    (local $q i32)
    (local $n i32)
    (local $c i32)
    (local.set $base (call $contentAt (i32.const 0)))
    (local.set $q (i32.add (local.get $p) (i32.const 1)))
    (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
    (if (i32.eqz (call $isAlpha (i32.load8_u (i32.add (local.get $base) (local.get $q)))))
      (then (return (i32.const 0))))
    (local.set $q (i32.add (local.get $q) (i32.const 1)))
    (local.set $n (i32.const 1))
    (block $scheme
      (loop $l
        (br_if $scheme (i32.ge_u (local.get $q) (local.get $end)))
        (local.set $c (i32.load8_u (i32.add (local.get $base) (local.get $q))))
        (br_if $scheme (i32.eqz (i32.or (call $isAlnum (local.get $c))
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c) (i32.const "+")))
            (i32.eq (local.get $c) (i32.const "-"))))))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (local.set $n (i32.add (local.get $n) (i32.const 1)))
        (br_if $scheme (i32.gt_u (local.get $n) (i32.const 32)))
        (br $l)))
    (if (i32.or (i32.lt_u (local.get $n) (i32.const 2)) (i32.gt_u (local.get $n) (i32.const 32)))
      (then (return (i32.const 0))))
    (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
    (if (i32.ne (i32.load8_u (i32.add (local.get $base) (local.get $q))) (i32.const ":"))
      (then (return (i32.const 0))))
    (local.set $q (i32.add (local.get $q) (i32.const 1)))
    (block $body
      (loop $l
        (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
        (local.set $c (i32.load8_u (i32.add (local.get $base) (local.get $q))))
        (br_if $body (i32.eq (local.get $c) (i32.const ">")))
        (if (i32.or (i32.le_u (local.get $c) (i32.const 32)) (i32.eq (local.get $c) (i32.const "<")))
          (then (return (i32.const 0))))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $l)))
    (i32.add (local.get $q) (i32.const 1)))

  ;; `<user@host>`; returns the offset just past `>`, or 0
  (func $scanAutolinkEmail (param $p i32) (param $end i32) (result i32)
    (local $base i32)
    (local $q i32)
    (local $c i32)
    (local $n i32)
    (local $seg i32)
    (local $k i32)
    (local.set $base (call $contentAt (i32.const 0)))
    (local.set $q (i32.add (local.get $p) (i32.const 1)))
    (block $local
      (loop $l
        (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
        (local.set $c (i32.load8_u (i32.add (local.get $base) (local.get $q))))
        (br_if $local (i32.eq (local.get $c) (i32.const "@")))
        (local.set $k (i32.sub (local.get $c) (i32.const 33)))
        (if (i32.eqz (i32.or (call $isAlnum (local.get $c))
              (if (result i32) (i32.le_u (local.get $k) (i32.const 63))
                (then (i32.wrap_i64 (i64.and
                  (i64.shr_u (i64.const 0xe00000005000767d)
                    (i64.extend_i32_u (local.get $k)))
                  (i64.const 1))))
                (else
                  (local.set $k (i32.sub (local.get $c) (i32.const 97)))
                  (i32.and (i32.le_u (local.get $k) (i32.const 29))
                    (i32.wrap_i64 (i64.and
                      (i64.shr_u (i64.const 0x3c000000)
                        (i64.extend_i32_u (local.get $k)))
                      (i64.const 1))))))))
          (then (return (i32.const 0))))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (local.set $n (i32.add (local.get $n) (i32.const 1)))
        (br $l)))
    (if (i32.eqz (local.get $n)) (then (return (i32.const 0))))
    (local.set $q (i32.add (local.get $q) (i32.const 1)))
    ;; one or more dot-separated labels of alphanumerics and hyphens
    (block $host
      (loop $label
        (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
        (if (i32.eqz (call $isAlnum (i32.load8_u (i32.add (local.get $base) (local.get $q)))))
          (then (return (i32.const 0))))
        (local.set $seg (i32.const 0))
        (block $labelDone
          (loop $l
            (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
            (local.set $c (i32.load8_u (i32.add (local.get $base) (local.get $q))))
            (br_if $labelDone (i32.eqz (i32.or (call $isAlnum (local.get $c))
              (i32.eq (local.get $c) (i32.const "-")))))
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (local.set $seg (i32.add (local.get $seg) (i32.const 1)))
            (br_if $labelDone (i32.gt_u (local.get $seg) (i32.const 63)))
            (br $l)))
        (if (i32.eq (i32.load8_u (i32.add (local.get $base)
              (i32.sub (local.get $q) (i32.const 1)))) (i32.const "-"))
          (then (return (i32.const 0))))
        (br_if $host (i32.ne (local.get $c) (i32.const ".")))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $label)))
    (if (i32.ne (local.get $c) (i32.const ">")) (then (return (i32.const 0))))
    (i32.add (local.get $q) (i32.const 1)))

)
