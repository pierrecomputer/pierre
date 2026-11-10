(module
  (import "./memory.wat")
  (import "./types.wat")
  (import "./scan.wat")
  (import "./out.wat")
  (import "./inline.wat")

  ;; GFM's extended autolinks: bare `www.` and `scheme://` URLs and bare email
  ;; addresses become links. They never fire inside a bracket, and never reach
  ;; back into a construct that was already recognized.

  ;; trailing punctuation, unbalanced closing parens and entity references are
  ;; not part of an extended autolink
  (func $autolinkDelim (param $beg i32) (param $scan i32) (param $end i32) (result i32)
    (local $base i32)
    (local $c i32)
    (local $parens i32) ;; `)` minus `(` in the scanned part
    (local $ne i32)
    (local.set $base (global.get $contentBase))
    (block $scanned
      (loop $l
        (br_if $scanned (i32.ge_u (local.get $scan) (local.get $end)))
        (local.set $c (i32.load8_u (i32.add (local.get $base) (local.get $scan))))
        (br_if $scanned (i32.or
          (call $isWhiteByte (local.get $c)) (i32.eq (local.get $c) (i32.const "<"))))
        (local.set $parens (i32.sub
          (i32.add (local.get $parens) (i32.eq (local.get $c) (i32.const ")")))
          (i32.eq (local.get $c) (i32.const "("))))
        (local.set $scan (i32.add (local.get $scan) (i32.const 1)))
        (br $l)))
    (block $trimmed
      (loop $l
        (br_if $trimmed (i32.le_u (local.get $scan) (local.get $beg)))
        (local.set $c (i32.load8_u
          (i32.add (local.get $base) (i32.sub (local.get $scan) (i32.const 1)))))
        (if (i32.eq (local.get $c) (i32.const ")"))
          (then
            (br_if $trimmed (i32.le_s (local.get $parens) (i32.const 0)))
            (local.set $parens (i32.sub (local.get $parens) (i32.const 1)))
            (local.set $scan (i32.sub (local.get $scan) (i32.const 1)))
            (br $l)))
        ;; `?!.,:*_~'"`
        (if (call $byteIn (local.get $c)
              (i64.const 0x8400548600000000) (i64.const 0x4000000080000000))
          (then
            (local.set $scan (i32.sub (local.get $scan) (i32.const 1)))
            (br $l)))
        (if (i32.eq (local.get $c) (i32.const ";"))
          (then
            (local.set $ne (i32.sub (local.get $scan) (i32.const 2)))
            (block $back
              (loop $b
                (br_if $back (i32.le_u (local.get $ne) (local.get $beg)))
                (br_if $back (i32.eqz (call $isAlpha
                  (i32.load8_u (i32.add (local.get $base) (local.get $ne))))))
                (local.set $ne (i32.sub (local.get $ne) (i32.const 1)))
                (br $b)))
            (local.set $scan (select (local.get $ne) (i32.sub (local.get $scan) (i32.const 1))
              (i32.and
                (i32.lt_u (local.get $ne) (i32.sub (local.get $scan) (i32.const 2)))
                (i32.eq (i32.load8_u (i32.add (local.get $base) (local.get $ne)))
                  (i32.const "&")))))
            (br $l)))))
    (local.get $scan))

  ;; Set when a domain fails for an underscore in its last two segments: the
  ;; start of the second-to-last segment. A later `www.` that starts before it
  ;; scans to the same two segments and fails too. Reset for each leaf.
  (global $wwwRejectBefore (mut i32) (i32.const 0))

  ;; the length of the domain name at $p, or 0
  (func $checkDomain (param $p i32) (param $end i32) (param $allowShort i32) (result i32)
    (local $base i32)
    (local $i i32)
    (local $np i32)
    (local $uscore1 i32)
    (local $uscore2 i32)
    (local $c i32)
    (local $cp i32)
    (local $seg i32)
    (local $prevSeg i32)
    (local.set $base (global.get $contentBase))
    (local.set $seg (local.get $p))
    (local.set $prevSeg (local.get $p))
    (local.set $i (i32.add (local.get $p) (i32.const 1)))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (i32.add (local.get $i) (i32.const 1)) (local.get $end)))
        (local.set $c (i32.load8_u (i32.add (local.get $base) (local.get $i))))
        (if (i32.and (i32.eq (local.get $c) (i32.const "\5c"))
              (i32.lt_u (i32.add (local.get $i) (i32.const 2)) (local.get $end)))
          (then
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (local.set $c (i32.load8_u (i32.add (local.get $base) (local.get $i))))))
        (if (i32.eq (local.get $c) (i32.const "_"))
          (then (local.set $uscore2 (i32.add (local.get $uscore2) (i32.const 1))))
          (else (if (i32.eq (local.get $c) (i32.const "."))
            (then
              (local.set $prevSeg (local.get $seg))
              (local.set $seg (i32.add (local.get $i) (i32.const 1)))
              (local.set $uscore1 (local.get $uscore2))
              (local.set $uscore2 (i32.const 0))
              (local.set $np (i32.add (local.get $np) (i32.const 1))))
            ;; letters, digits, `-`, and non-ASCII other than whitespace or punctuation
            (else (br_if $done (if (result i32) (i32.lt_u (local.get $c) (i32.const 0x80))
              (then (i32.eqz (call $byteIn (local.get $c)
                (i64.const 0x3ff200000000000) (i64.const 0x7fffffe07fffffe))))
              (else
                (local.set $cp (call $utf8At
                  (i32.add (local.get $base) (local.get $i))
                  (i32.add (local.get $base) (local.get $end))))
                (i32.or (call $isWhiteCp (local.get $cp)) (call $isPunctCp (local.get $cp))))))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    ;; no underscores in the last two segments of the domain
    (if (i32.or (local.get $uscore1) (local.get $uscore2))
      (then
        (global.set $wwwRejectBefore (local.get $prevSeg))
        (return (i32.const 0))))
    (select (i32.sub (local.get $i) (local.get $p)) (i32.const 0)
      (i32.or (local.get $allowShort) (local.get $np))))

  ;; Mark the URL that starts at $beg, with its domain at $host, and return
  ;; its end, or 0 when it is none. $www is 1 for a bare `www.` domain, which
  ;; needs a second segment and something after `www.`, and gets `http://`.
  (func $urlAutolink (param $beg i32) (param $host i32) (param $end i32) (param $www i32) (result i32)
    (local $n i32)
    (local.set $n (call $checkDomain (local.get $host) (local.get $end) (i32.eqz (local.get $www))))
    (if (i32.eqz (local.get $n)) (then (return (i32.const 0))))
    (local.set $n (call $autolinkDelim
      (local.get $beg) (i32.add (local.get $host) (local.get $n)) (local.get $end)))
    (if (i32.le_u (local.get $n) (i32.add (local.get $host) (i32.shl (local.get $www) (i32.const 2))))
      (then (return (i32.const 0))))
    (drop (call $markNew (enum.get $Mk.extlink) (local.get $beg) (local.get $n) (local.get $www)))
    (local.get $n))

  ;; The $n bytes (at most 8) at content offset $off as a little-endian word,
  ;; with ASCII letters folded to lowercase.
  (func $foldedWord (param $off i32) (param $n i32) (result i64)
    (i64.and
      (i64.or (i64.load (i32.add (global.get $contentBase) (local.get $off)))
        (i64.const 0x2020202020202020))
      (i64.shr_u (i64.const -1) (i64.extend_i32_u
        (i32.sub (i32.const 64) (i32.shl (local.get $n) (i32.const 3)))))))

  ;; `www.` at the `.`, which the caller found
  (func $tryWwwAutolink (param $p i32) (param $end i32) (result i32)
    (local $base i32)
    (local $beg i32)
    (local $n i32)
    (local.set $base (global.get $contentBase))
    (local.set $beg (i32.sub (local.get $p) (i32.const 3)))
    (block $no
      (br_if $no (i32.ne (i32.and (i32.load (i32.add (local.get $base) (local.get $beg)))
        (i32.const 0xdfdfdf)) (i32.const "WWW")))
      (br_if $no (global.get $bracketSp))
      (br_if $no (i32.lt_u (local.get $p) (i32.const 3)))
      (br_if $no (i32.lt_u (local.get $beg) (global.get $lastMarkEnd)))
      ;; only after whitespace, `*`, `_`, `~` or `(`
      (if (local.get $beg)
        (then (br_if $no (i32.eqz (call $byteIn
          (i32.load8_u (i32.sub (i32.add (local.get $base) (local.get $beg)) (i32.const 1)))
          (i64.const 0x50100003e00) (i64.const 0x4000000080000000))))))
      (br_if $no (i32.lt_u (local.get $beg) (global.get $wwwRejectBefore)))
      (br_if $no (i32.eqz (local.tee $n
        (call $urlAutolink (local.get $beg) (local.get $beg) (local.get $end) (i32.const 1)))))
      (return (local.get $n)))
    (i32.add (local.get $p) (i32.const 1)))

  ;; `scheme://` at the `:`
  (func $tryUrlAutolink (param $p i32) (param $end i32) (result i32)
    (local $base i32)
    (local $beg i32)
    (local $n i32)
    (local $w i64)
    (local.set $base (global.get $contentBase))
    (block $no
      (br_if $no (i32.ne (i32.load16_u offset=1 (i32.add (local.get $base) (local.get $p)))
        (i32.const "//")))
      (br_if $no (global.get $bracketSp))
      (br_if $no (i32.gt_u (i32.add (local.get $p) (i32.const 4)) (local.get $end)))
      (local.set $beg (local.get $p))
      (block $rewound
        (loop $l
          (br_if $rewound (i32.le_u (local.get $beg) (global.get $lastMarkEnd)))
          (br_if $rewound (i32.eqz (call $isAlpha
            (i32.load8_u (i32.sub (i32.add (local.get $base) (local.get $beg)) (i32.const 1))))))
          (local.set $beg (i32.sub (local.get $beg) (i32.const 1)))
          (br $l)))
      ;; the scheme and its colon: a longer run of letters matches no word
      (local.set $w (call $foldedWord (local.get $beg)
        (i32.add (i32.sub (local.get $p) (local.get $beg)) (i32.const 1))))
      (br_if $no (i32.eqz (i32.or (i64.eq (local.get $w) (i64.const "http:"))
        (i32.or (i64.eq (local.get $w) (i64.const "https:"))
          (i64.eq (local.get $w) (i64.const "ftp:"))))))
      ;; The host starts with a letter or digit. Past ASCII that is any
      ;; character other than whitespace or punctuation.
      (local.set $n (i32.load8_u offset=3 (i32.add (local.get $base) (local.get $p))))
      (br_if $no (if (result i32) (i32.lt_u (local.get $n) (i32.const 0x80))
        (then (i32.eqz (call $isAlnum (local.get $n))))
        (else
          (local.set $n (call $utf8At
            (i32.add (i32.add (local.get $base) (local.get $p)) (i32.const 3))
            (i32.add (local.get $base) (local.get $end))))
          (i32.or (call $isWhiteCp (local.get $n)) (call $isPunctCp (local.get $n))))))
      (br_if $no (i32.eqz (local.tee $n (call $urlAutolink (local.get $beg)
        (i32.add (local.get $p) (i32.const 3)) (local.get $end) (i32.const 0)))))
      (return (local.get $n)))
    (i32.add (local.get $p) (i32.const 1)))

  ;; a bare email address, or one with a `mailto:` or `xmpp:` scheme, at the `@`
  (func $tryEmailAutolink (param $p i32) (param $end i32) (result i32)
    (local $base i32)
    (local $beg i32)
    (local $c i32)
    (local $q i32)
    (local $np i32)
    (local $kind i32)
    (local $xmpp i32)
    (local $k i32)
    (local $m i32)
    (local $stop i32)
    (local.set $base (global.get $contentBase))
    (block $no
      (br_if $no (global.get $bracketSp))
      (local.set $beg (local.get $p))
      ;; Marks [$k, $nSlots) are `_` runs that the local part absorbs. They are
      ;; the newest marks and still unresolved, since no bracket is open.
      (local.set $k (global.get $nSlots))
      (local.set $stop (global.get $lastMarkEnd))
      (block $rewound
        (loop $l
          (if (i32.le_u (local.get $beg) (local.get $stop))
            (then
              (br_if $rewound (i32.eqz (local.get $k)))
              (local.set $m (call $slotAt (i32.sub (local.get $k) (i32.const 1))))
              ;; an emphasis mark of `_` that ends here
              (br_if $rewound (i32.or
                (i32.ne (i32.load offset=$M.end (local.get $m)) (local.get $beg))
                (i32.ne (i32.and (i32.load offset=$M.type (local.get $m)) (i32.const 0xff00ff))
                  (i32.or (enum.get $Mk.emph) (i32.const 0x5f0000)))))
              (local.set $beg (i32.load offset=$M.beg (local.get $m)))
              (local.set $k (i32.sub (local.get $k) (i32.const 1)))
              ;; the end of the mark before it, read from the previous slot
              (local.set $stop (select
                (i32.load offset=$M.end (i32.sub (local.get $m) (i32.const $M.size)))
                (i32.const 0) (local.get $k)))
              (br $l)))
          ;; letters, digits, `.`, `+`, `-` and `_`
          (br_if $rewound (i32.eqz (call $byteIn
            (i32.load8_u (i32.sub (i32.add (local.get $base) (local.get $beg)) (i32.const 1)))
            (i64.const 0x3ff680000000000) (i64.const 0x7fffffe87fffffe))))
          (local.set $beg (i32.sub (local.get $beg) (i32.const 1)))
          (br $l)))
      (br_if $no (i32.eq (local.get $beg) (local.get $p)))
      ;; An explicit scheme of $m bytes keeps the address verbatim. Glued to
      ;; a word before it, the scheme is text before a bare address.
      (local.set $m (select (i32.const 7)
        (select (i32.const 5) (i32.const 0)
          (i32.and (i32.ge_u (local.get $beg) (i32.add (local.get $stop) (i32.const 5)))
            (i64.eq (call $foldedWord (i32.sub (local.get $beg) (i32.const 5)) (i32.const 5))
              (i64.const "xmpp:"))))
        (i32.and (i32.ge_u (local.get $beg) (i32.add (local.get $stop) (i32.const 7)))
          (i64.eq (call $foldedWord (i32.sub (local.get $beg) (i32.const 7)) (i32.const 7))
            (i64.const "mailto:")))))
      (if (i32.and (i32.ne (local.get $beg) (local.get $m))
            (call $isAlnum (i32.load8_u (i32.sub
              (i32.add (local.get $base) (i32.sub (local.get $beg) (local.get $m))) (i32.const 1)))))
        (then (local.set $m (i32.const 0))))
      (local.set $beg (i32.sub (local.get $beg) (local.get $m)))
      (local.set $kind (i32.shl (i32.eqz (local.get $m)) (i32.const 1)))
      (local.set $xmpp (i32.eq (local.get $m) (i32.const 5)))
      (local.set $q (i32.add (local.get $p) (i32.const 1)))
      (block $host
        (loop $l
          (br_if $host (i32.ge_u (local.get $q) (local.get $end)))
          (local.set $c (i32.load8_u (i32.add (local.get $base) (local.get $q))))
          (if (i32.eq (local.get $c) (i32.const "."))
            (then
              ;; a dot only between alphanumerics
              (br_if $host (i32.ge_u (i32.add (local.get $q) (i32.const 1)) (local.get $end)))
              (br_if $host (i32.eqz (call $isAlnum
                (i32.load8_u offset=1 (i32.add (local.get $base) (local.get $q))))))
              (local.set $np (i32.add (local.get $np) (i32.const 1))))
            ;; letters, digits, `-`, `_`, and `/` after `xmpp:`
            (else (br_if $host (i32.eqz (i32.or
              (call $byteIn (local.get $c)
                (i64.const 0x3ff200000000000) (i64.const 0x7fffffe87fffffe))
              (i32.and (local.get $xmpp) (i32.eq (local.get $c) (i32.const "/"))))))))
          (local.set $q (i32.add (local.get $q) (i32.const 1)))
          (br $l)))
      (br_if $no (i32.lt_u (i32.sub (local.get $q) (local.get $p)) (i32.const 3)))
      (br_if $no (i32.eqz (local.get $np)))
      (br_if $no (i32.eqz (call $isAlpha
        (i32.load8_u (i32.sub (i32.add (local.get $base) (local.get $q)) (i32.const 1))))))
      (local.set $m (local.get $k))
      (block $absorbed
        (loop $l
          (br_if $absorbed (i32.ge_u (local.get $m) (global.get $nSlots)))
          (call $delimRemove (local.get $m))
          (local.set $m (i32.add (local.get $m) (i32.const 1)))
          (br $l)))
      (global.set $nSlots (local.get $k))
      (drop (call $markNew (enum.get $Mk.extlink) (local.get $beg) (local.get $q) (local.get $kind)))
      (return (local.get $q)))
    (i32.add (local.get $p) (i32.const 1)))
)
