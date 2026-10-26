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
    (local $i i32)
    (local $c i32)
    (local $opening i32)
    (local $closing i32)
    (local $ne i32)
    (local.set $base (call $contentAt (i32.const 0)))
    (local.set $i (local.get $scan))
    (block $scanned
      (loop $l
        (br_if $scanned (i32.ge_u (local.get $i) (local.get $end)))
        (local.set $c (i32.load8_u (i32.add (local.get $base) (local.get $i))))
        (br_if $scanned (i32.or
          (call $isWhiteByte (local.get $c)) (i32.eq (local.get $c) (i32.const "<"))))
        (if (i32.eq (local.get $c) (i32.const "("))
          (then (local.set $opening (i32.add (local.get $opening) (i32.const 1))))
          (else (if (i32.eq (local.get $c) (i32.const ")"))
            (then (local.set $closing (i32.add (local.get $closing) (i32.const 1)))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (local.set $end (local.get $i))
    (block $trimmed
      (loop $l
        (br_if $trimmed (i32.le_u (local.get $end) (local.get $beg)))
        (local.set $c (i32.load8_u
          (i32.add (local.get $base) (i32.sub (local.get $end) (i32.const 1)))))
        (if (i32.eq (local.get $c) (i32.const ")"))
          (then
            (br_if $trimmed (i32.le_u (local.get $closing) (local.get $opening)))
            (local.set $closing (i32.sub (local.get $closing) (i32.const 1)))
            (local.set $end (i32.sub (local.get $end) (i32.const 1)))
            (br $l)))
        ;; `!"'*,.:?_` in a bitset for bytes 33..96; `~` sits outside it.
        (if (i32.or
              (i32.and
                (i32.le_u (i32.sub (local.get $c) (i32.const 33)) (i32.const 63))
                (i32.wrap_i64 (i64.and
                  (i64.shr_u (i64.const 0x4000000042002a43)
                    (i64.extend_i32_u (i32.sub (local.get $c) (i32.const 33))))
                  (i64.const 1))))
              (i32.eq (local.get $c) (i32.const "~")))
          (then
            (local.set $end (i32.sub (local.get $end) (i32.const 1)))
            (br $l)))
        (if (i32.eq (local.get $c) (i32.const ";"))
          (then
            (local.set $ne (i32.sub (local.get $end) (i32.const 2)))
            (block $back
              (loop $b
                (br_if $back (i32.le_u (local.get $ne) (local.get $beg)))
                (br_if $back (i32.eqz (call $isAlpha
                  (i32.load8_u (i32.add (local.get $base) (local.get $ne))))))
                (local.set $ne (i32.sub (local.get $ne) (i32.const 1)))
                (br $b)))
            (if (i32.and
                  (i32.lt_u (local.get $ne) (i32.sub (local.get $end) (i32.const 2)))
                  (i32.eq (i32.load8_u (i32.add (local.get $base) (local.get $ne)))
                    (i32.const "&")))
              (then (local.set $end (local.get $ne)))
              (else (local.set $end (i32.sub (local.get $end) (i32.const 1)))))
            (br $l)))
        (br $trimmed)))
    (local.get $end))

  ;; the length of the domain name at $p, or 0
  (func $checkDomain (param $p i32) (param $end i32) (param $allowShort i32) (result i32)
    (local $base i32)
    (local $i i32)
    (local $np i32)
    (local $uscore1 i32)
    (local $uscore2 i32)
    (local $c i32)
    (local $cp i32)
    (local.set $base (call $contentAt (i32.const 0)))
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
              (local.set $uscore1 (local.get $uscore2))
              (local.set $uscore2 (i32.const 0))
              (local.set $np (i32.add (local.get $np) (i32.const 1))))
            (else
              (if (i32.ne (local.get $c) (i32.const "-"))
                (then
                  (if (i32.lt_u (local.get $c) (i32.const 0x80))
                    (then (br_if $done (i32.eqz (call $isAlnum (local.get $c)))))
                    (else
                      (local.set $cp (call $utf8At
                        (i32.add (local.get $base) (local.get $i))
                        (i32.add (local.get $base) (local.get $end))))
                      (br_if $done (i32.or
                        (call $isWhiteCp (local.get $cp))
                        (call $isPunctCp (local.get $cp))))))))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    ;; no underscores in the last two segments of the domain
    (if (i32.or (local.get $uscore1) (local.get $uscore2))
      (then (return (i32.const 0))))
    (if (local.get $allowShort) (then (return (i32.sub (local.get $i) (local.get $p)))))
    (select (i32.sub (local.get $i) (local.get $p)) (i32.const 0) (local.get $np)))

  (func $pushExtLink (param $beg i32) (param $end i32) (param $kind i32)
    (local $i i32)
    (local.set $i (call $markNew (enum.get $Mk.extlink) (local.get $beg) (local.get $end)))
    (i32.store offset=$M.data (call $slotAt (local.get $i)) (local.get $kind)))

  ;; `www.` at the `.`, which the caller found
  (func $tryWwwAutolink (param $p i32) (param $end i32) (result i32)
    (local $base i32)
    (local $beg i32)
    (local $c i32)
    (local $n i32)
    (local $stop i32)
    (local.set $base (call $contentAt (i32.const 0)))
    (if (global.get $bracketSp) (then (return (i32.add (local.get $p) (i32.const 1)))))
    (if (i32.lt_u (local.get $p) (i32.const 3)) (then (return (i32.add (local.get $p) (i32.const 1)))))
    (local.set $beg (i32.sub (local.get $p) (i32.const 3)))
    (if (i32.lt_u (local.get $beg) (global.get $lastMarkEnd))
      (then (return (i32.add (local.get $p) (i32.const 1)))))
    (if (i32.ne (i32.and (i32.load (i32.add (local.get $base) (local.get $beg)))
          (i32.const 0xdfdfdf)) (i32.const "WWW"))
      (then (return (i32.add (local.get $p) (i32.const 1)))))
    (if (local.get $beg)
      (then
        (local.set $c (i32.load8_u
          (i32.add (local.get $base) (i32.sub (local.get $beg) (i32.const 1)))))
        (if (i32.eqz (i32.or (call $isWhiteByte (local.get $c))
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $c) (i32.const "_")))
                (i32.or (i32.eq (local.get $c) (i32.const "~")) (i32.eq (local.get $c) (i32.const "("))))))
          (then (return (i32.add (local.get $p) (i32.const 1)))))))
    (local.set $n (call $checkDomain (local.get $beg) (local.get $end) (i32.const 0)))
    (if (i32.eqz (local.get $n)) (then (return (i32.add (local.get $p) (i32.const 1)))))
    (local.set $stop (call $autolinkDelim
      (local.get $beg) (i32.add (local.get $beg) (local.get $n)) (local.get $end)))
    (if (i32.le_u (local.get $stop) (i32.add (local.get $beg) (i32.const 4)))
      (then (return (i32.add (local.get $p) (i32.const 1)))))
    (call $pushExtLink (local.get $beg) (local.get $stop) (i32.const 1))
    (local.get $stop))

  ;; `scheme://` at the `:`
  (func $tryUrlAutolink (param $p i32) (param $end i32) (result i32)
    (local $base i32)
    (local $beg i32)
    (local $n i32)
    (local $stop i32)
    (local $len i32)
    (local.set $base (call $contentAt (i32.const 0)))
    (if (global.get $bracketSp) (then (return (i32.add (local.get $p) (i32.const 1)))))
    (if (i32.gt_u (i32.add (local.get $p) (i32.const 4)) (local.get $end))
      (then (return (i32.add (local.get $p) (i32.const 1)))))
    (if (i32.ne (i32.load16_u (i32.add (local.get $base) (i32.add (local.get $p) (i32.const 1))))
          (i32.const "//"))
      (then (return (i32.add (local.get $p) (i32.const 1)))))
    (local.set $beg (local.get $p))
    (block $rewound
      (loop $l
        (br_if $rewound (i32.le_u (local.get $beg) (global.get $lastMarkEnd)))
        (br_if $rewound (i32.eqz (call $isAlpha
          (i32.load8_u (i32.add (local.get $base) (i32.sub (local.get $beg) (i32.const 1)))))))
        (local.set $beg (i32.sub (local.get $beg) (i32.const 1)))
        (br $l)))
    (local.set $len (i32.sub (local.get $p) (local.get $beg)))
    (if (i32.eqz (i32.or
          (i32.or
            (call $schemeIs (local.get $beg) (local.get $len) (i64.const "http") (i32.const 4))
            (call $schemeIs (local.get $beg) (local.get $len) (i64.const "https") (i32.const 5)))
          (call $schemeIs (local.get $beg) (local.get $len) (i64.const "ftp") (i32.const 3))))
      (then (return (i32.add (local.get $p) (i32.const 1)))))
    ;; the first character of the host must be alphanumeric
    (if (i32.eqz (call $isAlnum
          (i32.load8_u (i32.add (local.get $base) (i32.add (local.get $p) (i32.const 3))))))
      (then (return (i32.add (local.get $p) (i32.const 1)))))
    (local.set $n (call $checkDomain
      (i32.add (local.get $p) (i32.const 3)) (local.get $end) (i32.const 1)))
    (if (i32.eqz (local.get $n)) (then (return (i32.add (local.get $p) (i32.const 1)))))
    (local.set $stop (call $autolinkDelim
      (local.get $beg)
      (i32.add (i32.add (local.get $p) (i32.const 3)) (local.get $n))
      (local.get $end)))
    (if (i32.le_u (local.get $stop) (i32.add (local.get $p) (i32.const 3)))
      (then (return (i32.add (local.get $p) (i32.const 1)))))
    (call $pushExtLink (local.get $beg) (local.get $stop) (i32.const 0))
    (local.get $stop))

  (func $schemeIs (param $beg i32) (param $len i32) (param $word i64) (param $n i32) (result i32)
    (local $mask i64)
    (if (i32.ne (local.get $len) (local.get $n)) (then (return (i32.const 0))))
    (local.set $mask (i64.shr_u (i64.const -1)
      (i64.mul (i64.const 8) (i64.extend_i32_u (i32.sub (i32.const 8) (local.get $n))))))
    (i64.eqz (i64.and (i64.xor
      (i64.or (i64.load (call $contentAt (local.get $beg)))
        (i64.const 0x2020202020202020))
      (local.get $word)) (local.get $mask))))

  ;; a bare email address, or one with a `mailto:` or `xmpp:` scheme, at the `@`
  (func $tryEmailAutolink (param $p i32) (param $end i32) (result i32)
    (local $base i32)
    (local $beg i32)
    (local $c i32)
    (local $q i32)
    (local $np i32)
    (local $kind i32)
    (local $xmpp i32)
    (local.set $base (call $contentAt (i32.const 0)))
    (if (global.get $bracketSp) (then (return (i32.add (local.get $p) (i32.const 1)))))
    (local.set $kind (i32.const 2))
    (local.set $beg (local.get $p))
    (block $rewound
      (loop $l
        (br_if $rewound (i32.le_u (local.get $beg) (global.get $lastMarkEnd)))
        (local.set $c (i32.load8_u
          (i32.add (local.get $base) (i32.sub (local.get $beg) (i32.const 1)))))
        (br_if $rewound (i32.eqz (i32.or (call $isAlnum (local.get $c))
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c) (i32.const "+")))
            (i32.or (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c) (i32.const "_")))))))
        (local.set $beg (i32.sub (local.get $beg) (i32.const 1)))
        (br $l)))
    (if (i32.eq (local.get $beg) (local.get $p)) (then (return (i32.add (local.get $p) (i32.const 1)))))
    ;; an explicit scheme keeps the address verbatim
    (if (i32.ge_u (local.get $beg) (i32.add (global.get $lastMarkEnd) (i32.const 7)))
      (then
        (if (call $schemeIs (i32.sub (local.get $beg) (i32.const 7)) (i32.const 7)
              (i64.const "mailto:") (i32.const 7))
          (then
            (local.set $beg (i32.sub (local.get $beg) (i32.const 7)))
            (local.set $kind (i32.const 0))))))
    (if (i32.and (i32.eq (local.get $kind) (i32.const 2))
          (i32.ge_u (local.get $beg) (i32.add (global.get $lastMarkEnd) (i32.const 5))))
      (then
        (if (call $schemeIs (i32.sub (local.get $beg) (i32.const 5)) (i32.const 5)
              (i64.const "xmpp:") (i32.const 5))
          (then
            (local.set $beg (i32.sub (local.get $beg) (i32.const 5)))
            (local.set $kind (i32.const 0))
            (local.set $xmpp (i32.const 1))))))
    (if (i32.eqz (local.get $kind))
      (then
        (if (local.get $beg)
          (then
            (if (call $isAlnum (i32.load8_u
                  (i32.add (local.get $base) (i32.sub (local.get $beg) (i32.const 1)))))
              (then (return (i32.add (local.get $p) (i32.const 1)))))))))
    (local.set $q (i32.add (local.get $p) (i32.const 1)))
    (block $host
      (loop $l
        (br_if $host (i32.ge_u (local.get $q) (local.get $end)))
        (local.set $c (i32.load8_u (i32.add (local.get $base) (local.get $q))))
        (if (call $isAlnum (local.get $c))
          (then
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (br $l)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (br_if $host (i32.ge_u (i32.add (local.get $q) (i32.const 1)) (local.get $end)))
            (br_if $host (i32.eqz (call $isAlnum
              (i32.load8_u (i32.add (local.get $base) (i32.add (local.get $q) (i32.const 1)))))))
            (local.set $np (i32.add (local.get $np) (i32.const 1)))
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (br $l)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c) (i32.const "_")))
          (then
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (br $l)))
        (if (i32.and (local.get $xmpp) (i32.eq (local.get $c) (i32.const "/")))
          (then
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (br $l)))
        (br $host)))
    (if (i32.lt_u (i32.sub (local.get $q) (i32.add (local.get $p) (i32.const 1))) (i32.const 2))
      (then (return (i32.add (local.get $p) (i32.const 1)))))
    (if (i32.eqz (local.get $np)) (then (return (i32.add (local.get $p) (i32.const 1)))))
    (local.set $c (i32.load8_u (i32.add (local.get $base) (i32.sub (local.get $q) (i32.const 1)))))
    (if (i32.eqz (i32.or (call $isAlpha (local.get $c)) (i32.eq (local.get $c) (i32.const "."))))
      (then (return (i32.add (local.get $p) (i32.const 1)))))
    (if (i32.le_u (local.get $q) (i32.add (local.get $p) (i32.const 1)))
      (then (return (i32.add (local.get $p) (i32.const 1)))))
    (call $pushExtLink (local.get $beg) (local.get $q) (local.get $kind))
    (local.get $q))
)
