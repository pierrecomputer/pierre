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
  (const $M.ch 10)     ;; a delimiter run's character
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
  (global $bracketLo (mut i32) (i32.const 0))
  (global $scannedBackticks (mut i32) (i32.const 0))
  (global $tickTop (mut i32) (i32.const 0))
  (global $lastMarkEnd (mut i32) (i32.const 0))
  (global $literalNeedsEscape (mut i32) (i32.const 0))

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

  ;; Append a mark and return its index. $head fills the type, flags, ch and
  ;; aux bytes; rem starts at zero. $data fills the shared prev/data word.
  (func $markNew (param $head i32) (param $beg i32) (param $end i32) (param $data i32) (result i32)
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
    (i64.store offset=$M.type (local.get $m) (i64.extend_i32_u (local.get $head)))
    (i32.store offset=$M.data (local.get $m) (local.get $data))
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
    (local $mask i32)
    (local $scanEnd i32)
    (local $markLo v128)
    (local $markHi v128)
    (local $classFlags v128)
    (local.set $markLo (v128.load (i32.const $mem.markLo)))
    (local.set $markHi (v128.load (i32.const $mem.markHi)))
    (global.set $literalNeedsEscape (i32.const 0))
    (global.set $markOff (select
      (i32.const 0)
      (i32.and (i32.add (global.get $contentLen) (i32.const 63)) (i32.const -32))
      (i32.ne (global.get $contentBase) (global.get $scratchBase))))
    (global.set $scratchTailUsed (i32.const 0))
    (global.set $nSlots (i32.const 0))
    (global.set $delimHead (i32.const -1))
    (global.set $delimTail (i32.const -1))
    (global.set $bracketSp (i32.const 0))
    (global.set $bracketLo (i32.const 0))
    (global.set $scannedBackticks (i32.const 0))
    (global.set $tickTop (i32.const 0))
    (global.set $htmlNoClose (i32.const 0))
    (global.set $wwwRejectBefore (i32.const 0))
    (global.set $lastMarkEnd (i32.const 0))
    (local.set $end (global.get $contentLen))
    (block $done
      (loop $l
        (local.set $base (global.get $contentBase))
        ;; Cached lanes are content-relative, so scratch growth cannot stale
        ;; them. Handlers advance p past consumed syntax without changing text.
        (if (i32.lt_u (local.get $p) (local.get $scanEnd))
          (then
            (local.set $mask (i32.and (local.get $mask)
              (i32.shl (i32.const -1)
                (i32.sub (local.get $p) (i32.sub (local.get $scanEnd) (i32.const 16))))))
            (if (local.get $mask)
              (then (local.set $p (i32.add
                (i32.sub (local.get $scanEnd) (i32.const 16))
                (call $firstBit (local.get $mask)))))
              (else (local.set $p (local.get $scanEnd)))))
          (else (local.set $mask (i32.const 0))))
        (block $foundMark
          (br_if $foundMark (local.get $mask))
          (loop $scan
            (br_if $foundMark (i32.ge_u (local.get $p) (local.get $end)))
            (local.set $classFlags (call $markFlags (i32.add (local.get $base) (local.get $p))
              (local.get $markLo) (local.get $markHi)))
            (local.set $scanEnd (i32.add (local.get $p) (i32.const 16)))
            (if (i64.ne (i64.or
                  (i64x2.extract_lane 0 (local.get $classFlags))
                  (i64x2.extract_lane 1 (local.get $classFlags))) (i64.const 0))
              (then
                (local.set $mask (i8x16.bitmask (i8x16.ne
                  (local.get $classFlags) (i8x16.splat (i32.const 0)))))
                (local.set $p (i32.add (local.get $p) (call $firstBit (local.get $mask))))
                (br $foundMark)))
            (local.set $p (local.get $scanEnd))
            (br $scan)))
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $c (i32.load8_u (i32.add (local.get $base) (local.get $p))))
        (block $dispatched
          ;; Split the ASCII candidates before testing individual handlers.
          ;; This keeps punctuation and emphasis from crossing unrelated cases.
          (block $delimiters
            (if (i32.ge_u (local.get $c) (i32.const 64))
              (then
                (if (i32.eq (local.get $c) (i32.const "\5c"))
                  (then
                    (local.set $p (call $handleBackslash (local.get $p) (local.get $end)))
                    (br $dispatched)))
                (if (i32.eq (local.get $c) (i32.const "\60"))
                  (then
                    (local.set $p (call $handleBackticks (local.get $p) (local.get $end)))
                    (br $dispatched)))
                (if (i32.eq (local.get $c) (i32.const "["))
                  (then
                    (local.set $p (call $pushBracket (local.get $p) (i32.const 0)))
                    (br $dispatched)))
                (if (i32.eq (local.get $c) (i32.const "]"))
                  (then
                    (local.set $p (call $handleCloseBracket (local.get $p) (local.get $end)))
                    (br $dispatched)))
                (if (i32.eq (local.get $c) (i32.const "@"))
                  (then
                    (local.set $p (call $tryEmailAutolink (local.get $p) (local.get $end)))
                    (br $dispatched)))
                (br $delimiters)))
            (if (i32.eq (local.get $c) (i32.const "."))
              (then
                (local.set $p (call $tryWwwAutolink (local.get $p) (local.get $end)))
                (br $dispatched)))
            (if (i32.eq (local.get $c) (i32.const 10))
              (then
                (local.set $p (call $handleNewline (local.get $p) (local.get $end)))
                (br $dispatched)))
            (if (i32.eq (local.get $c) (i32.const ":"))
              (then
                (local.set $p (call $tryUrlAutolink (local.get $p) (local.get $end)))
                (br $dispatched)))
            ;; These bytes are literal text, but prevent copying unmarked gaps
            ;; without HTML escaping. Once that is required, stop finding them.
            (if (i32.or (i32.eqz (local.get $c))
                  (i32.or (i32.eq (local.get $c) (i32.const 34))
                    (i32.eq (local.get $c) (i32.const ">"))))
              (then
                (global.set $literalNeedsEscape (i32.const 1))
                (local.set $markLo (v128.load (i32.const $mem.syntaxLo)))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $dispatched)))
            (if (i32.eq (local.get $c) (i32.const "&"))
              (then
                (local.set $p (call $handleEntity (local.get $p) (local.get $end)))
                (br $dispatched)))
            (if (i32.eq (local.get $c) (i32.const "<"))
              (then
                (local.set $p (call $handlePointy (local.get $p) (local.get $end)))
                (br $dispatched)))
            (if (i32.eq (local.get $c) (i32.const "!"))
              (then
                (local.set $p
                  (if (result i32) (i32.and
                        (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $end))
                        (i32.eq (i32.load8_u offset=1 (i32.add (local.get $base) (local.get $p)))
                          (i32.const "[")))
                    (then (call $pushBracket (local.get $p) (i32.const 1)))
                    (else (i32.add (local.get $p) (i32.const 1)))))
                (br $dispatched))))
          (local.set $p (call $handleDelim (local.get $p) (local.get $end))))
        (br $l)))
    (call $processEmphasis (i32.const 0) (i32.const -1)))

  (func $handleBackslash (param $p i32) (param $end i32) (result i32)
    (local $c i32)
    (if (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $end))
      (then
        (local.set $c (i32.load8_u offset=1 (i32.add (global.get $contentBase) (local.get $p))))
        (if (i32.or (call $isAsciiPunct (local.get $c)) (i32.eq (local.get $c) (i32.const 10)))
          (then
            (drop (call $markNew
              (select (enum.get $Mk.hardbreak) (enum.get $Mk.escape)
                (i32.eq (local.get $c) (i32.const 10)))
              (local.get $p) (i32.add (local.get $p) (i32.const 2)) (i32.const 0)))
            (return (i32.add (local.get $p) (i32.const 2)))))))
    (i32.add (local.get $p) (i32.const 1)))

  (func $handleNewline (param $p i32) (param $end i32) (result i32)
    (local $at i32)
    (local $q i32)
    (local.set $at (i32.add (global.get $contentBase) (local.get $p)))
    ;; HTML copies an ordinary soft break verbatim. Leave it in the surrounding
    ;; text span when neither side needs trimming. Brackets retain marks because
    ;; an image's alt text turns newlines into spaces; ANSI also needs its hook.
    (if (i32.eqz (i32.or (global.get $mode) (global.get $bracketSp)))
      (then
        (if (i32.eqz (i32.or (i32.eqz (local.get $p))
              (i32.or
                (call $isSpaceByte (i32.load8_u (i32.sub (local.get $at) (i32.const 1))))
                (call $isSpaceByte (i32.load8_u offset=1 (local.get $at))))))
          (then
            ;; Extended autolinks still cannot reach back across this break.
            (global.set $lastMarkEnd (i32.add (local.get $p) (i32.const 1)))
            (return (global.get $lastMarkEnd))))))
    ;; leading spaces of the next line are never content
    (local.set $q (i32.sub
      (call $skipSpace (i32.add (local.get $at) (i32.const 1))
        (i32.add (global.get $contentBase) (local.get $end)))
      (global.get $contentBase)))
    (drop (call $markNew
      (select (enum.get $Mk.hardbreak) (enum.get $Mk.softbreak)
        (i32.and (i32.ge_u (local.get $p) (i32.const 2))
          (i32.eq (i32.load16_u (i32.sub (local.get $at) (i32.const 2))) (i32.const 0x2020))))
      (local.get $p) (local.get $q) (i32.const 0)))
    (local.get $q))

  ;; The mark keeps the value code, because the conversion scratch is reused
  ;; by every mark.
  (func $handleEntity (param $p i32) (param $end i32) (result i32)
    (local $n i32)
    (local.set $n (call $entityMatch (i32.add (global.get $contentBase) (local.get $p))
      (i32.add (global.get $contentBase) (local.get $end))))
    (if (i32.eqz (local.get $n))
      (then
        (global.set $literalNeedsEscape (i32.const 1))
        (return (i32.add (local.get $p) (i32.const 1)))))
    (local.set $n (i32.add (local.get $p) (local.get $n)))
    (drop (call $markNew (enum.get $Mk.entity) (local.get $p) (local.get $n)
      (global.get $entCp)))
    (local.get $n))

  (func $handlePointy (param $p i32) (param $end i32) (result i32)
    (local $base i32)
    (local $n i32)
    (local $type i32)
    (local $data i32)
    (local.set $base (global.get $contentBase))
    (local.set $type (enum.get $Mk.autolink))
    (block $found
      (br_if $found (local.tee $n (call $scanAutolinkUri
        (i32.add (local.get $base) (local.get $p)) (i32.add (local.get $base) (local.get $end)))))
      (local.set $data (i32.const 1))
      (br_if $found (local.tee $n (call $scanAutolinkEmail
        (i32.add (local.get $base) (local.get $p)) (i32.add (local.get $base) (local.get $end)))))
      (local.set $type (enum.get $Mk.rawhtml))
      (local.set $data (i32.const 0))
      (br_if $found (local.tee $n (call $scanHtmlAny
        (i32.add (local.get $base) (local.get $p)) (i32.add (local.get $base) (local.get $end)))))
      (global.set $literalNeedsEscape (i32.const 1))
      (return (i32.add (local.get $p) (i32.const 1))))
    (local.set $n (i32.sub (local.get $n) (local.get $base)))
    (drop (call $markNew (local.get $type) (local.get $p) (local.get $n) (local.get $data)))
    (local.get $n))

  (func $handleBackticks (param $p i32) (param $end i32) (result i32)
    (local $base i32)
    (local $q i32)
    (local $close i32)
    (local.set $base (global.get $contentBase))
    (local.set $q (local.get $p))
    (block $counted
      (loop $l
        (br_if $counted (i32.ge_u (local.get $q) (local.get $end)))
        (br_if $counted (i32.ne (i32.load8_u (i32.add (local.get $base) (local.get $q)))
          (i32.const "\60")))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $l)))
    (local.set $close (call $scanToClosingBackticks (local.get $q) (local.get $end)
      (i32.sub (local.get $q) (local.get $p))))
    (if (i32.eqz (local.get $close)) (then (return (local.get $q))))
    (drop (call $markNew (enum.get $Mk.code) (local.get $p) (local.get $close) (local.get $q)))
    (local.get $close))

  ;; The position just past a run of exactly $n backticks, or 0. Runs longer
  ;; than 255 never pair. $mem.tickMemo holds, per run length, the start of
  ;; the latest such run seen in this leaf; entries above $tickTop, the
  ;; longest run seen, are stale. Until a scan reaches EOF, each scan covers a
  ;; later range, so stores only raise entries. That scan leaves each entry at
  ;; its length's last run, so a later scan for a length whose last run starts
  ;; before it fails without scanning, and further stores could only lower it.
  (func $scanToClosingBackticks (param $p i32) (param $end i32) (param $n i32) (result i32)
    (local $base i32)
    (local $q i32)
    (local $ticks i32)
    (local.set $base (global.get $contentBase))
    (if (i32.gt_u (local.get $n) (i32.const 255)) (then (return (i32.const 0))))
    (if (i32.and (global.get $scannedBackticks)
          (i32.or (i32.gt_u (local.get $n) (global.get $tickTop))
            (i32.le_u (i32.load offset=$mem.tickMemo (i32.shl (local.get $n) (i32.const 2)))
              (local.get $p))))
      (then (return (i32.const 0))))
    (block $eof
      (loop $l
        (local.set $p (i32.sub
          (call $findByte (i32.add (local.get $base) (local.get $p))
            (i32.add (local.get $base) (local.get $end)) (i32.const "\60"))
          (local.get $base)))
        (br_if $eof (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $q (local.get $p))
        (block $counted
          (loop $c
            (br_if $counted (i32.ge_u (local.get $q) (local.get $end)))
            (br_if $counted (i32.ne (i32.load8_u (i32.add (local.get $base) (local.get $q)))
              (i32.const "\60")))
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (br $c)))
        (local.set $ticks (i32.sub (local.get $q) (local.get $p)))
        (if (i32.and (i32.le_u (local.get $ticks) (i32.const 255))
              (i32.eqz (global.get $scannedBackticks)))
          (then
            (block $fresh
              (loop $clear
                (br_if $fresh (i32.le_u (local.get $ticks) (global.get $tickTop)))
                (global.set $tickTop (i32.add (global.get $tickTop) (i32.const 1)))
                (i32.store offset=$mem.tickMemo
                  (i32.shl (global.get $tickTop) (i32.const 2)) (i32.const 0))
                (br $clear)))
            (i32.store offset=$mem.tickMemo (i32.shl (local.get $ticks) (i32.const 2))
              (local.get $p))))
        (if (i32.eq (local.get $ticks) (local.get $n)) (then (return (local.get $q))))
        (local.set $p (local.get $q))
        (br $l)))
    (global.set $scannedBackticks (i32.const 1))
    (i32.const 0))

  (func $handleDelim (param $p i32) (param $end i32) (result i32)
    (local $base i32)
    (local $c i32)
    (local $q i32)
    (local $n i32)
    (local $k i32)
    (local $flags i32)
    (local $i i32)
    (local $m i32)
    (local.set $base (global.get $contentBase))
    (local.set $c (i32.load8_u (i32.add (local.get $base) (local.get $p))))
    (local.set $q (local.get $p))
    (block $counted
      (loop $l
        (br_if $counted (i32.ge_u (local.get $q) (local.get $end)))
        (br_if $counted (i32.ne (i32.load8_u (i32.add (local.get $base) (local.get $q)))
          (local.get $c)))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $l)))
    (local.set $n (i32.sub (local.get $q) (local.get $p)))
    ;; only runs of one or two tildes are strikethrough delimiters
    (if (i32.and (i32.eq (local.get $c) (i32.const "~")) (i32.gt_u (local.get $n) (i32.const 2)))
      (then (return (local.get $q))))
    ;; $k is the class of the character before the run times four plus the
    ;; class after it: 2 for whitespace, 1 for punctuation, else 0. The text
    ;; boundaries count as whitespace. Two bits per
    ;; $k give left and right flanking, which for `*` and `~` are canOpen and
    ;; canClose. `_` differs only between two other characters: it is
    ;; intraword and can do neither.
    (local.set $k (select (i32.const 10)
      (call $utf8Before (i32.add (local.get $base) (local.get $p)) (local.get $base))
      (i32.eqz (local.get $p))))
    (local.set $flags (select (i32.const 10)
      (call $utf8At (i32.add (local.get $base) (local.get $q))
        (i32.add (local.get $base) (local.get $end)))
      (i32.ge_u (local.get $q) (local.get $end))))
    (local.set $k (i32.or
      (i32.shl (select (i32.const 2) (call $isPunctCp (local.get $k)) (call $isWhiteCp (local.get $k)))
        (i32.const 2))
      (select (i32.const 2) (call $isPunctCp (local.get $flags)) (call $isWhiteCp (local.get $flags)))))
    (local.set $flags (i32.and
      (i32.shr_u (i32.const 0x52d2b) (i32.shl (local.get $k) (i32.const 1))) (i32.const 3)))
    (if (i32.or (i32.eqz (local.get $flags))
          (i32.and (i32.eq (local.get $c) (i32.const "_")) (i32.eqz (local.get $k))))
      (then (return (local.get $q))))
    (local.set $i (call $markNew
      (i32.or (enum.get $Mk.emph) (i32.or
        (i32.shl (i32.or (local.get $flags) (i32.const $MF.inList)) (i32.const 8))
        (i32.shl (local.get $c) (i32.const 16))))
      (local.get $p) (local.get $q) (global.get $delimTail)))
    (local.set $m (call $slotAt (local.get $i)))
    (i32.store offset=$M.rem (local.get $m) (local.get $n))
    (i64.store offset=$M.next (local.get $m) (i64.const 0xffffffff))
    (i32.store offset=$M.closeTail (local.get $m) (i32.const 0))
    (if (i32.ge_s (global.get $delimTail) (i32.const 0))
      (then (i32.store offset=$M.next (call $slotAt (global.get $delimTail)) (local.get $i)))
      (else (global.set $delimHead (local.get $i))))
    (global.set $delimTail (local.get $i))
    (local.get $q))

  (func $processEmphasis (param $bottom i32) (param $delimBottom i32)
    (local $closer i32)
    (local $opener i32)
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
    ;; Opener bottoms are indexed by the run character's 0x60 bits, whether
    ;; the closer can open, and its length modulo 3: bytes 32..123.
    (local.set $bottom4 (i32x4.splat (local.get $bottom)))
    (local.set $i (i32.const 32))
    (loop $init
      (v128.store offset=$mem.opener (local.get $i) (local.get $bottom4))
      (local.set $i (i32.add (local.get $i) (i32.const 16)))
      (br_if $init (i32.lt_u (local.get $i) (i32.const 128))))
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
        (local.set $idx (i32.or
          (i32.or (i32.and (local.get $ch) (i32.const 0x60))
            (i32.shl (i32.and (local.get $flags) (i32.const $MF.canOpen)) (i32.const 4)))
          (i32.shl (i32.rem_u (local.get $closerLen) (i32.const 3)) (i32.const 2))))
        (local.set $opener (i32.load offset=$M.prev (local.get $cm)))
        (block $noMatch
          (block $match
            (loop $back
              (br_if $noMatch (i32.lt_s (local.get $opener) (i32.const 0)))
              (local.set $om (call $slotAt (local.get $opener)))
              (br_if $noMatch (i32.lt_u (i32.load offset=$M.beg (local.get $om))
                (i32.load offset=$mem.opener (local.get $idx))))
              (local.set $openerFlags (i32.load8_u offset=$M.flags (local.get $om)))
              (if (i32.and
                    (i32.and (local.get $openerFlags) (i32.const $MF.canOpen))
                    (i32.eq (i32.load8_u offset=$M.ch (local.get $om)) (local.get $ch)))
                (then
                  (br_if $match (i32.or
                    (i32.or
                      (i32.eqz (i32.or
                        (i32.and (local.get $flags) (i32.const $MF.canOpen))
                        (i32.and (local.get $openerFlags) (i32.const $MF.canClose))))
                      (i32.eqz (i32.rem_u (local.get $closerLen) (i32.const 3))))
                    (i32.rem_u (i32.add
                      (call $markLen (local.get $om))
                      (local.get $closerLen)) (i32.const 3))))))
              (local.set $opener (i32.load offset=$M.prev (local.get $om)))
              (br $back)))
          (local.set $closer (call $insertEmph (local.get $opener) (local.get $closer)))
          (br $walk))
        (local.set $old (local.get $closer))
        (local.set $closer (i32.load offset=$M.next (local.get $cm)))
        (i32.store offset=$mem.opener (local.get $idx) (i32.load offset=$M.beg (local.get $cm)))
        (if (i32.eqz (i32.and (local.get $flags) (i32.const $MF.canOpen)))
          (then (call $delimRemove (local.get $old))))
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
    (local $kind i32)
    (local $tilde i32)
    (local $tmp i32)
    (local $next i32)
    (local $openerRem i32)
    (local $closerRem i32)
    (local.set $om (call $slotAt (local.get $opener)))
    (local.set $cm (call $slotAt (local.get $closer)))
    (local.set $openerRem (i32.load offset=$M.rem (local.get $om)))
    (local.set $closerRem (i32.load offset=$M.rem (local.get $cm)))
    (local.set $use (select (i32.const 2) (i32.const 1) (i32.and
      (i32.ge_u (local.get $openerRem) (i32.const 2))
      (i32.ge_u (local.get $closerRem) (i32.const 2)))))
    (local.set $kind
      (select (i32.const $T.em) (i32.const $T.strong) (i32.eq (local.get $use) (i32.const 1))))
    ;; strikethrough consumes both runs at once, and only when they match;
    ;; either way both delimiters are done
    (if (local.tee $tilde (i32.eq (i32.load8_u offset=$M.ch (local.get $cm)) (i32.const "~")))
      (then
        (local.set $use (select (local.get $openerRem) (i32.const 0)
          (i32.eq (local.get $openerRem) (local.get $closerRem))))
        (local.set $kind (i32.const $T.del))))
    (local.set $openerRem (i32.sub (local.get $openerRem) (local.get $use)))
    (local.set $closerRem (i32.sub (local.get $closerRem) (local.get $use)))
    (i32.store offset=$M.rem (local.get $om) (local.get $openerRem))
    (i32.store offset=$M.rem (local.get $cm) (local.get $closerRem))
    (if (local.get $use)
      (then (call $tagPair (local.get $opener) (local.get $closer) (local.get $kind))))
    ;; delimiters between the pair can never match anything now
    (local.set $tmp (i32.load offset=$M.next (call $slotAt (local.get $opener))))
    (block $cleared
      (loop $l
        (br_if $cleared (i32.lt_s (local.get $tmp) (i32.const 0)))
        (br_if $cleared (i32.eq (local.get $tmp) (local.get $closer)))
        (local.set $next (i32.load offset=$M.next (call $slotAt (local.get $tmp))))
        (call $delimRemove (local.get $tmp))
        (local.set $tmp (local.get $next))
        (br $l)))
    (local.set $next (i32.load offset=$M.next (call $slotAt (local.get $closer))))
    (if (i32.or (local.get $tilde) (i32.eqz (local.get $openerRem)))
      (then (call $delimRemove (local.get $opener))))
    (if (i32.or (local.get $tilde) (i32.eqz (local.get $closerRem)))
      (then
        (call $delimRemove (local.get $closer))
        (return (local.get $next))))
    (local.get $closer))

  ;; The bracket stack is a ring of the newest 256 open brackets. Brackets
  ;; below $bracketLo were dropped when it was full and stay literal text.
  (func $bracketAt (param $i i32) (result i32)
    (i32.add (i32.const $mem.bracket)
      (i32.mul (i32.and (local.get $i) (i32.const 255)) (i32.const $B.size))))

  (func $pushBracket (param $p i32) (param $image i32) (result i32)
    (local $i i32)
    (local $b i32)
    (local $end i32)
    (local.set $end (i32.add (local.get $p) (i32.add (local.get $image) (i32.const 1))))
    (local.set $i (call $markNew
      (i32.or (enum.get $Mk.bracket) (i32.shl (local.get $image) (i32.const 10)))
      (local.get $p) (local.get $end) (i32.const 0)))
    (if (i32.eq (i32.sub (global.get $bracketSp) (global.get $bracketLo)) (i32.const 256))
      (then (global.set $bracketLo (i32.add (global.get $bracketLo) (i32.const 1)))))
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
    (local $t i32)
    (local $n i32)
    (local $image i32)
    (local $urlB i32)
    (local $urlE i32)
    (local $titleB i32)
    (local $titleE i32)
    (local $flags i32)
    (local $angle i32)
    (local $e i32)
    (local $def i32)
    (local $rawB i32)
    (local $rawE i32)
    (local $open i32)
    (local $bottom i32)
    (local $delimBottom i32)
    (local.set $initial (i32.add (local.get $p) (i32.const 1)))
    (if (i32.eqz (global.get $bracketSp)) (then (return (local.get $initial))))
    (block $fail
      (if (i32.eq (global.get $bracketSp) (global.get $bracketLo))
        (then
          (global.set $bracketLo (i32.sub (global.get $bracketSp) (i32.const 1)))
          (br $fail)))
      (local.set $b (call $bracketAt (i32.sub (global.get $bracketSp) (i32.const 1))))
      (br_if $fail (i32.eqz (i32.load8_u offset=9 (local.get $b))))
      (local.set $open (i32.load (local.get $b)))
      (local.set $image (i32.load8_u offset=8 (local.get $b)))
      (local.set $bottom (i32.load offset=$M.end (call $slotAt (local.get $open))))
      (local.set $delimBottom (i32.load offset=4 (local.get $b)))
      (local.set $q (local.get $initial))
      (block $resolved
        ;; a GFM footnote reference
        (if (i32.and (i32.eqz (local.get $image))
              (i32.and
                (i32.gt_u (local.get $p) (local.get $bottom))
                (i32.eq (i32.load8_u (i32.add (global.get $contentBase) (local.get $bottom)))
                  (i32.const "^"))))
          (then
            (local.set $def (call $lookupLabel
              (i32.add (local.get $bottom) (i32.const 1)) (local.get $p) (i32.const 1)))
            (if (local.get $def)
              (then
                (local.set $t (call $slotAt (local.get $open)))
                (i32.store8 offset=$M.type (local.get $t) (enum.get $Mk.footnote))
                (i32.store offset=$M.end (local.get $t) (local.get $initial))
                (i32.store offset=$M.data (local.get $t) (local.get $def))
                ;; enclosing brackets stay active
                (local.set $image (i32.const 1))
                (br $resolved)))))
        (block $link
          ;; The inline form works on absolute positions: nothing here can
          ;; move scratch. $e is the absolute content end.
          (local.set $base (global.get $contentBase))
          (local.set $e (i32.add (local.get $base) (local.get $end)))
          (local.set $t (i32.add (local.get $base) (local.get $q)))
          ;; an inline link or image
          (if (i32.and (i32.lt_u (local.get $t) (local.get $e))
                (i32.eq (i32.load8_u (local.get $t)) (i32.const "(")))
            (then
              (local.set $t (call $skipWs (i32.add (local.get $t) (i32.const 1)) (local.get $e)))
              (local.set $n (call $scanLinkDest (local.get $t) (local.get $e)))
              (if (i32.ge_s (local.get $n) (i32.const 0))
                (then
                  (local.set $angle (i32.eq (i32.load8_u (local.get $t)) (i32.const "<")))
                  (local.set $urlB
                    (i32.sub (i32.add (local.get $t) (local.get $angle)) (local.get $base)))
                  (local.set $urlE
                    (i32.sub (i32.sub (local.get $n) (local.get $angle)) (local.get $base)))
                  (local.set $t (call $skipWs (local.get $n) (local.get $e)))
                  (if (i32.ne (local.get $t) (local.get $n))
                    (then
                      (local.set $titleE (call $scanLinkTitle (local.get $t) (local.get $e)))
                      (if (local.get $titleE)
                        (then
                          (local.set $flags (i32.const $LF.hasTitle))
                          (local.set $titleB
                            (i32.sub (i32.add (local.get $t) (i32.const 1)) (local.get $base)))
                          (local.set $t (call $skipWs (local.get $titleE) (local.get $e)))
                          (local.set $titleE (i32.sub (i32.sub (local.get $titleE) (i32.const 1))
                            (local.get $base)))))))
                  (if (i32.and (i32.lt_u (local.get $t) (local.get $e))
                        (i32.eq (i32.load8_u (local.get $t)) (i32.const ")")))
                    (then
                      (local.set $q (i32.sub (i32.add (local.get $t) (i32.const 1)) (local.get $base)))
                      (br $link)))
                  (local.set $flags (i32.const 0))))))
          ;; A reference link or image. A missing or empty label uses the link
          ;; text instead, unless the text contains another bracket.
          (local.set $t (call $scanLinkLabel (i32.add (local.get $base) (local.get $q)) (local.get $e)))
          (local.set $q
            (select (i32.sub (local.get $t) (local.get $base)) (local.get $q) (local.get $t)))
          (local.set $rawB (i32.add (local.get $initial) (i32.const 1)))
          (local.set $rawE (i32.sub (local.get $q) (i32.const 1)))
          (if (i32.ge_u (local.get $rawB) (local.get $rawE))
            (then
              (local.set $rawB (local.get $bottom))
              (local.set $rawE (select (local.get $bottom) (local.get $p)
                (i32.load8_u offset=10 (local.get $b))))))
          (br_if $link (local.tee $def
            (call $lookupLabel (local.get $rawB) (local.get $rawE) (i32.const 0))))
          ;; Repair only the original document's trailing label, after real
          ;; references have failed. Code blocks and definition destinations never
          ;; reach this inline path; rebuilt nested content retains its source end.
          (br_if $fail (i32.or (local.get $image)
            (i32.or (i32.eqz (i32.and (i32.load8_u (i32.const 1)) (i32.const 4)))
              (i32.or (i32.ne (global.get $contentInputEnd) (global.get $eof))
                (i32.ne (local.get $initial)
                  (i32.sub (global.get $contentLen)
                    (i32.sub (global.get $eof) (global.get $completeClosedLabelEnd))))))))
          (local.set $q (local.get $initial))
          (local.set $flags (i32.const $LF.pending)))
        (local.set $n (call $markNew
          (i32.or (enum.get $Mk.linkclose) (i32.shl
            (i32.or (local.get $flags) (i32.shl (local.get $image) (i32.const 2))) (i32.const 8)))
          (local.get $p) (local.get $q) (local.get $urlE)))
        (local.set $t (call $slotAt (local.get $open)))
        (i32.store8 offset=$M.type (local.get $t) (enum.get $Mk.linkopen))
        (i32.store offset=$M.data (local.get $t) (local.get $n))
        (local.set $t (call $slotAt (local.get $n)))
        (i32.store offset=$L.urlBeg (local.get $t) (local.get $urlB))
        (i32.store offset=$L.titleBeg (local.get $t) (local.get $titleB))
        (i32.store offset=$L.titleEnd (local.get $t) (local.get $titleE))
        (i32.store offset=$L.def (local.get $t) (local.get $def)))
      (call $processEmphasis (local.get $bottom) (local.get $delimBottom))
      (global.set $bracketSp (i32.sub (global.get $bracketSp) (i32.const 1)))
      ;; A link may not contain another link: every bracket still open below this
      ;; one can no longer become one. Those below an inactive `[` already are.
      (if (i32.eqz (local.get $image))
        (then
          (local.set $n (global.get $bracketSp))
          (block $done
            (loop $l
              (br_if $done (i32.le_u (local.get $n) (global.get $bracketLo)))
              (local.set $n (i32.sub (local.get $n) (i32.const 1)))
              (local.set $b (call $bracketAt (local.get $n)))
              (if (i32.eqz (i32.load8_u offset=8 (local.get $b)))
                (then
                  (br_if $done (i32.eqz (i32.load8_u offset=9 (local.get $b))))
                  (i32.store8 offset=9 (local.get $b) (i32.const 0))))
              (br $l)))))
      (return (local.get $q)))
    (global.set $bracketSp (i32.sub (global.get $bracketSp) (i32.const 1)))
    (local.get $initial))

  ;; normalize [$b,$e) of the content buffer and look it up in the reference map.
  ;; A footnote label is prefixed so the two namespaces never collide.
  (func $lookupLabel (param $b i32) (param $e i32) (param $footnote i32) (result i32)
    (local $tmp i32)
    (local $normalized i64)
    ;; with no definitions there is nothing to normalize the text for
    (if (i32.or (i32.eqz (global.get $linkHash)) (i32.ge_u (local.get $b) (local.get $e)))
      (then (return (i32.const 0))))
    (call $ensureScratch (i32.add
      (i32.add (global.get $markOff) (i32.shl (i32.add (global.get $nSlots) (i32.const 2))
        (i32.const 5)))
      (i32.add (i32.mul (i32.sub (local.get $e) (local.get $b)) (i32.const 3)) (i32.const 64))))
    (local.set $tmp (call $slotAt (i32.add (global.get $nSlots) (i32.const 1))))
    (local.set $normalized (call $normalizeLabel
      (i32.add (global.get $contentBase) (local.get $b))
      (i32.add (global.get $contentBase) (local.get $e))
      (local.get $tmp) (local.get $footnote)))
    ;; an empty normalized label matches no definition
    (i32.load (call $linkSlot (local.get $tmp) (i32.wrap_i64 (local.get $normalized))
      (i32.wrap_i64 (i64.shr_u (local.get $normalized) (i64.const 32)))
      (select (enum.get $Blk.footnote) (enum.get $Blk.linkdef) (local.get $footnote)))))

  ;; `<scheme:...>` at $p; returns the position just past `>`, or 0
  (func $scanAutolinkUri (param $p i32) (param $end i32) (result i32)
    (local $q i32)
    (local $c i32)
    ;; a scheme of 2 to 32 letters, digits, `+`, `.` or `-`, starting with a letter
    (local.set $q (i32.add (local.get $p) (i32.const 1)))
    (block $scheme
      (loop $l
        (br_if $scheme (i32.ge_u (local.get $q) (local.get $end)))
        (local.set $c (i32.load8_u (local.get $q)))
        (br_if $scheme (i32.eqz (i32.or (call $isAlnum (local.get $c))
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c) (i32.const "+")))
            (i32.eq (local.get $c) (i32.const "-"))))))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br_if $l (i32.le_u (i32.sub (local.get $q) (local.get $p)) (i32.const 33)))))
    (if (i32.or (i32.gt_u (i32.sub (i32.sub (local.get $q) (local.get $p)) (i32.const 3))
          (i32.const 30))
          (i32.eqz (call $isAlpha (i32.load8_u offset=1 (local.get $p)))))
      (then (return (i32.const 0))))
    (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
    (if (i32.ne (i32.load8_u (local.get $q)) (i32.const ":"))
      (then (return (i32.const 0))))
    (loop $l
      (local.set $q (i32.add (local.get $q) (i32.const 1)))
      (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
      (local.set $c (i32.load8_u (local.get $q)))
      ;; no ASCII controls, space or `<`; NUL stands for U+FFFD
      (if (i32.or (i32.lt_u (i32.sub (local.get $c) (i32.const 1)) (i32.const 32))
            (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const 127))))
        (then (return (i32.const 0))))
      (br_if $l (i32.ne (local.get $c) (i32.const ">"))))
    (i32.add (local.get $q) (i32.const 1)))

  ;; `<user@host>` at $p; returns the position just past `>`, or 0
  (func $scanAutolinkEmail (param $p i32) (param $end i32) (result i32)
    (local $q i32)
    (local $c i32)
    (local $seg i32)
    (local.set $q (i32.add (local.get $p) (i32.const 1)))
    ;; one or more letters, digits or ``.!#$%&'*+/=?^_`{|}~-``
    (block $local
      (loop $l
        (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
        (local.set $c (i32.load8_u (local.get $q)))
        (br_if $local (i32.eq (local.get $c) (i32.const "@")))
        (if (i32.eqz (i32.and (i32.lt_u (local.get $c) (i32.const 128))
              (i32.wrap_i64 (i64.shr_u
                (select (i64.const 0x7fffffffc7fffffe) (i64.const 0xa3ffecfa00000000)
                  (i32.ge_u (local.get $c) (i32.const 64)))
                (i64.extend_i32_u (local.get $c))))))
          (then (return (i32.const 0))))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $l)))
    (if (i32.eq (local.get $q) (i32.add (local.get $p) (i32.const 1))) (then (return (i32.const 0))))
    ;; one or more dot-separated labels of alphanumerics and hyphens
    (loop $label
      (local.set $q (i32.add (local.get $q) (i32.const 1)))
      (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
      (if (i32.eqz (call $isAlnum (i32.load8_u (local.get $q))))
        (then (return (i32.const 0))))
      (local.set $seg (local.get $q))
      (block $labelDone
        (loop $l
          (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
          (local.set $c (i32.load8_u (local.get $q)))
          (br_if $labelDone (i32.eqz (i32.or (call $isAlnum (local.get $c))
            (i32.eq (local.get $c) (i32.const "-")))))
          (local.set $q (i32.add (local.get $q) (i32.const 1)))
          (br_if $l (i32.le_u (i32.sub (local.get $q) (local.get $seg)) (i32.const 63)))))
      (if (i32.eq (i32.load8_u offset=0 (i32.sub (local.get $q) (i32.const 1))) (i32.const "-"))
        (then (return (i32.const 0))))
      (br_if $label (i32.eq (local.get $c) (i32.const "."))))
    (if (i32.ne (local.get $c) (i32.const ">")) (then (return (i32.const 0))))
    (i32.add (local.get $q) (i32.const 1)))

)
