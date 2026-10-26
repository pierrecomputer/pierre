(module
  (import "../common.wat")
  (import "../embed.wat")
  (import "./html.wat")
  (import "./php.wat")

  ;; Markup shared by Blade and Razor. Unlike $htmlLex, the whole markup state is
  ;; one value the caller keeps, so a template construct can cut a tag anywhere
  ;; and the tag resumes after it.

  (func $tmplFind4 (param $p i32) (param $a i32) (param $b i32) (param $c i32) (param $d i32) (result i32)
    (local $mask i32)
    (local $w v128)
    (if (i32.ge_u (local.get $p) (global.get $end))
      (then (return (global.get $end))))
    (block $done
      (loop $simd
        (local.set $w (v128.load (local.get $p)))
        (local.set $mask
          (i8x16.bitmask
            (v128.or
              (v128.or
                (i8x16.eq (local.get $w) (i8x16.splat (local.get $a)))
                (i8x16.eq (local.get $w) (i8x16.splat (local.get $b))))
              (v128.or
                (i8x16.eq (local.get $w) (i8x16.splat (local.get $c)))
                (i8x16.eq (local.get $w) (i8x16.splat (local.get $d)))))))
        (if (local.get $mask)
          (then
            (local.set $p (i32.add (local.get $p) (i32.ctz (local.get $mask))))
            (br $done)))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br_if $simd (i32.lt_u (local.get $p) (global.get $end)))))
    (select (local.get $p) (global.get $end) (i32.lt_u (local.get $p) (global.get $end))))

  ;; $word: at most 8 bytes, source byte order.
  (func $tmplFindWord (param $p i32) (param $word i64) (param $n i32) (result i32)
    (local $mask i64)
    (local.set $mask
      (i64.shr_u
        (i64.const -1)
        (i64.extend_i32_u (i32.shl (i32.sub (i32.const 8) (local.get $n)) (i32.const 3)))))
    (block $done
      (loop $scan
        (local.set $p
          (call $lexFindByte (local.get $p) (i32.wrap_i64 (i64.and (local.get $word) (i64.const 255)))))
        (br_if $done (i32.gt_u (i32.add (local.get $p) (local.get $n)) (global.get $end)))
        (br_if $done (i64.eq (i64.and (i64.load (local.get $p)) (local.get $mask)) (local.get $word)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (select
      (local.get $p)
      (global.get $end)
      (i32.le_u (i32.add (local.get $p) (local.get $n)) (global.get $end))))

  ;; One still open at a chunk end resumes as a fixed-delimiter stream mode.
  (func $tmplComment (param $open i32) (param $close i32) (param $n i32)
    (local $lhs i32)
    (local $p i32)
    (local.set $lhs (global.get $ptr))
    (local.set $p
      (call $tmplFindWord
        (i32.add (local.get $lhs) (local.get $open))
        (i64.extend_i32_u (local.get $close))
        (local.get $n)))
    (global.set $ptr
      (select
        (i32.add (local.get $p) (local.get $n))
        (global.get $end)
        (i32.lt_u (local.get $p) (global.get $end))))
    (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
    (if (i32.ge_u (local.get $p) (global.get $end))
      (then (call $streamSetFixed32 (local.get $close) (local.get $n) (enum.get $Token.comment)))))

  ;; Drop the mode still open where a bounded range ended, as a whole-input scan
  ;; stops it at the same bound.
  (func $tmplCut
    (global.set $streamRegionKind (i32.const 0))
    (call $streamClearEmbedded))

  (func $tmplIsVoid (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local $w i64)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.gt_u (i32.sub (local.get $n) (i32.const 2)) (i32.const 4))
      (then (return (i32.const 0))))
    (local.set $w
      (i64.and
        (i64.or (i64.load (local.get $lhs)) (i64.const 0x2020202020202020))
        (i64.sub
          (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $n) (i32.const 3))))
          (i64.const 1))))
    (i32.or
      (i32.or
        (i32.or
          (i32.or (i64.eq (local.get $w) (i64.const "br")) (i64.eq (local.get $w) (i64.const "hr")))
          (i32.or (i64.eq (local.get $w) (i64.const "img")) (i64.eq (local.get $w) (i64.const "col"))))
        (i32.or
          (i32.or (i64.eq (local.get $w) (i64.const "wbr")) (i64.eq (local.get $w) (i64.const "area")))
          (i32.or (i64.eq (local.get $w) (i64.const "base")) (i64.eq (local.get $w) (i64.const "link")))))
      (i32.or
        (i32.or
          (i32.or (i64.eq (local.get $w) (i64.const "meta")) (i64.eq (local.get $w) (i64.const "embed")))
          (i32.or (i64.eq (local.get $w) (i64.const "input")) (i64.eq (local.get $w) (i64.const "param"))))
        (i32.or (i64.eq (local.get $w) (i64.const "track")) (i64.eq (local.get $w) (i64.const "source"))))))

  ;; Returns the new state with the stop reason in bits 24-31: 0 the range end, 1
  ;; a cut byte at $ptr, 2 a quoted expression value at $ptr, and with $dialect
  ;; bit 8 the end of a tag: 3 an opening start tag, 4 a void or self-closing
  ;; one, 5 a close tag.
  ;; State: bits 0-2 the mode (0 text, 1 before an attribute, 2 after a name, 3
  ;; after `=`, 4 a quoted value with its quote in bits 8-15); bit 3 a close tag;
  ;; bit 4 an expression value; bit 5 a Blade component; bit 6 a void element;
  ;; bits 16-17 the raw-text kind of a script or style tag.
  ;; $dialect: bit 1 Razor, 2 a Razor section body, 4 no constructs (verbatim), 16
  ;; the cut at $ptr is plain markup.
  (func $tmplMarkup (param $state i32) (param $dialect i32) (result i32)
    (local $at i32)
    (local $c i32)
    (local $cut i32)
    (local $cut2 i32)
    (local $kind i32)
    (local $lhs i32)
    (local $mode i32)
    (local $p i32)
    (local $q i32)
    (local $razor i32)
    (local $skip i32)
    (local.set $razor (i32.and (local.get $dialect) (i32.const 1)))
    (local.set $at (i32.const "@"))
    (local.set $cut (select (i32.const "@") (i32.const "{") (local.get $razor)))
    (local.set $cut2
      (select (i32.const "}") (i32.const "@") (i32.and (local.get $dialect) (i32.const 2))))
    ;; with no constructs, `<` stands in for the cut bytes
    (if (i32.and (local.get $dialect) (i32.const 4))
      (then
        (local.set $at (i32.const "<"))
        (local.set $cut (i32.const "<"))
        (local.set $cut2 (i32.const "<"))))
    (local.set $skip
      (select (global.get $ptr) (i32.const -1) (i32.and (local.get $dialect) (i32.const 16))))
    (block $out
      (loop $next
        (br_if $out (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $mode (i32.and (local.get $state) (i32.const 7)))
        (if (i32.eqz (local.get $mode))
          (then
            (local.set $p
              (call $tmplFind4
                (local.get $lhs)
                (i32.const "<")
                (i32.const "&")
                (local.get $cut)
                (local.get $cut2)))
            (if (i32.eq (local.get $p) (local.get $skip))
              (then
                (local.set $p
                  (call $tmplFind4
                    (i32.add (local.get $p) (i32.const 1))
                    (i32.const "<")
                    (i32.const "&")
                    (local.get $cut)
                    (local.get $cut2)))))
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (local.get $p))
            (global.set $ptr (local.get $p))
            (br_if $out (i32.ge_u (local.get $p) (global.get $end)))
            (local.set $c (i32.load8_u (local.get $p)))
            (if (i32.eq (local.get $c) (i32.const "&"))
              (then
                (if (i32.eqz (call $htmlEntity))
                  (then
                    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                    (call $emitTok (enum.get $Token.none) (local.get $p) (global.get $ptr))))
                (br $next)))
            (if (i32.ne (local.get $c) (i32.const "<"))
              (then (return (i32.or (local.get $state) (i32.const 0x1000000)))))
            (local.set $c (call $templateByte (i32.add (local.get $p) (i32.const 1))))
            (if (i32.eq (local.get $c) (i32.const "!"))
              (then
                (if
                  (i32.and
                    (i32.le_u (i32.add (local.get $p) (i32.const 4)) (global.get $end))
                    (i32.eq (i32.load (local.get $p)) (i32.const "<!--")))
                  (then (call $htmlComment (local.get $p)))
                  (else (call $htmlDecl (local.get $p) (i32.const 0) (enum.get $Token.tag.doctype))))
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const "?"))
              (then
                (if
                  (i32.and
                    (i32.eqz (i32.and (local.get $dialect) (i32.const 5)))
                    (call $phpIsOpen (local.get $p)))
                  (then (return (i32.or (local.get $state) (i32.const 0x1000000)))))
                (call $htmlDecl (local.get $p) (i32.const 1) (enum.get $Token.comment))
                (br $next)))
            (local.set $q (i32.add (local.get $p) (i32.const 1)))
            (if (i32.eq (local.get $c) (i32.const "/"))
              (then
                (local.set $q (i32.add (local.get $q) (i32.const 1)))
                (local.set $c (call $templateByte (local.get $q)))))
            (if
              (i32.or
                (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
                (i32.or (i32.eq (local.get $c) (i32.const "_")) (i32.ge_u (local.get $c) (i32.const 128))))
              (then
                (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $p) (local.get $q))
                (global.set $ptr (call $htmlNameEnd (local.get $q)))
                (call $emitTok (enum.get $Token.tag) (local.get $q) (global.get $ptr))
                (if (i32.eq (i32.sub (local.get $q) (local.get $p)) (i32.const 2))
                  (then (local.set $state (i32.const 9)))
                  (else
                    (local.set $state
                      (i32.or
                        (i32.or
                          (i32.const 1)
                          (i32.shl
                            (call $rawTextKind (local.get $q) (global.get $ptr))
                            (i32.const 16)))
                        (select
                          (i32.shl
                            (call $tmplIsVoid (local.get $q) (global.get $ptr))
                            (i32.const 6))
                          (i32.shl
                            (i32.and
                              (i32.and
                                (i32.eqz (i32.and (local.get $dialect) (i32.const 5)))
                                (i32.ge_u (i32.sub (global.get $ptr) (local.get $q)) (i32.const 2)))
                              (i32.eq (i32.load16_u (local.get $q)) (i32.const "x-")))
                            (i32.const 5))
                          (local.get $razor))))))
                (br $next)))
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (call $emitTok (enum.get $Token.none) (local.get $p) (global.get $ptr))
            (br $next)))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if (i32.eq (local.get $mode) (i32.const 4))
          (then
            (local.set $q (i32.and (i32.shr_u (local.get $state) (i32.const 8)) (i32.const 255)))
            ;; with no constructs, the quote stands in for the cut bytes
            (local.set $kind (select (local.get $q) (local.get $cut) (i32.and (local.get $dialect) (i32.const 4))))
            (local.set $c (select (local.get $q) (local.get $at) (i32.and (local.get $dialect) (i32.const 4))))
            (local.set $p (call $scanFind3 (local.get $lhs) (local.get $q) (local.get $kind) (local.get $c)))
            (if (i32.eq (local.get $p) (local.get $skip))
              (then
                (local.set $p
                  (call $scanFind3
                    (i32.add (local.get $p) (i32.const 1))
                    (local.get $q)
                    (local.get $kind)
                    (local.get $c)))))
            (if
              (i32.and
                (i32.lt_u (local.get $p) (global.get $end))
                (i32.eq (i32.load8_u (local.get $p)) (local.get $q)))
              (then
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (local.set $state (i32.or (i32.and (local.get $state) (i32.const 0xffff00e8)) (i32.const 1)))))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (local.get $p))
            (global.set $ptr (local.get $p))
            (br_if $next
              (i32.or
                (i32.ne (i32.and (local.get $state) (i32.const 7)) (i32.const 4))
                (i32.ge_u (local.get $p) (global.get $end))))
            (return (i32.or (local.get $state) (i32.const 0x1000000)))))
        (if (call $lexIsSpace (local.get $c))
          (then
            (call $scanWhitespace)
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (br $next)))
        (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const ">"))
            (i32.and
              (i32.eq (local.get $c) (i32.const "/"))
              (i32.eq (call $templateByte (local.get $p)) (i32.const ">"))))
          (then
            (local.set $p (i32.add (local.get $p) (i32.eq (local.get $c) (i32.const "/"))))
            (global.set $ptr (local.get $p))
            (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (local.get $p))
            (local.set $kind
              (select
                (i32.const 5)
                (select
                  (i32.const 4)
                  (i32.const 3)
                  (i32.or
                    (i32.eq (local.get $c) (i32.const "/"))
                    (i32.and (local.get $state) (i32.const 64))))
                (i32.and (local.get $state) (i32.const 8))))
            (local.set $c (i32.shr_u (local.get $state) (i32.const 16)))
            (local.set $state (i32.const 0))
            (if (i32.and (i32.ne (local.get $kind) (i32.const 5)) (i32.ne (local.get $c) (i32.const 0)))
              (then (call $htmlRawText (local.get $c))))
            (br_if $next (i32.eqz (i32.and (local.get $dialect) (i32.const 8))))
            (return (i32.shl (local.get $kind) (i32.const 24)))))
        ;; a stray `<` ends the tag; the text mode reads it again
        (if (i32.eq (local.get $c) (i32.const "<"))
          (then
            (local.set $state (i32.const 0))
            (br $next)))
        (if
          (i32.and
            (i32.ne (local.get $lhs) (local.get $skip))
            (i32.or (i32.eq (local.get $c) (local.get $cut)) (i32.eq (local.get $c) (local.get $at))))
          (then (return (i32.or (local.get $state) (i32.const 0x1000000)))))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (global.set $ptr (local.get $p))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (local.get $p))
            (if (i32.ne (local.get $mode) (i32.const 3))
              (then (local.set $state (i32.and (local.get $state) (i32.const -17)))))
            (local.set $state
              (i32.or
                (i32.and (local.get $state) (i32.const 0xffff00f8))
                (i32.or (i32.const 4) (i32.shl (local.get $c) (i32.const 8)))))
            (br_if $next (i32.eqz (i32.and (local.get $state) (i32.const 16))))
            (return (i32.or (local.get $state) (i32.const 0x2000000)))))
        (if (i32.eq (local.get $mode) (i32.const 3))
          (then
            (global.set $ptr (call $htmlValueEnd (local.get $lhs)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $state (i32.or (i32.and (local.get $state) (i32.const -24)) (i32.const 1)))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "="))
          (then
            (global.set $ptr (local.get $p))
            (call $emitTok (enum.get $Token.punctuation.delimiter.html) (local.get $lhs) (local.get $p))
            (local.set $state (i32.or (i32.and (local.get $state) (i32.const -8)) (i32.const 3)))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "/"))
          (then
            (global.set $ptr (local.get $p))
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (local.get $p))
            (br $next)))
        ;; Razor's `@name` and a Blade component's `:name` (not `::name`) take an
        ;; expression value
        (global.set $ptr (call $htmlNameEnd (local.get $lhs)))
        (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
        (local.set $state
          (i32.or
            (i32.or (i32.and (local.get $state) (i32.const -24)) (i32.const 2))
            (i32.shl
              (select
                (i32.eq (local.get $c) (i32.const "@"))
                (i32.and
                  (i32.and
                    (i32.ne (i32.and (local.get $state) (i32.const 32)) (i32.const 0))
                    (i32.eq (local.get $c) (i32.const ":")))
                  (i32.ne (call $templateByte (local.get $p)) (i32.const ":")))
                (local.get $razor))
              (i32.const 4))))
        (br $next)))
    (local.get $state))
)
