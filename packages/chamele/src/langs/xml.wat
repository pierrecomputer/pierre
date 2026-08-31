(module
  (import "../common.wat")

  (func $xmlNameChar (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.ge_u (local.get $c) (i32.const 0x80))
        (i32.le_u
          (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a"))
          (i32.const 25)))
      (i32.or
        (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9))
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "_"))
                  (i32.eq (local.get $c) (i32.const "-")))
          (i32.or (i32.eq (local.get $c) (i32.const "."))
                  (i32.eq (local.get $c) (i32.const ":")))))))

  (func $xmlNameStart (param $c i32) (result i32)
    (i32.or
      (i32.ge_u (local.get $c) (i32.const 0x80))
      (i32.or
        (i32.le_u
          (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a"))
          (i32.const 25))
        (i32.or (i32.eq (local.get $c) (i32.const "_"))
                (i32.eq (local.get $c) (i32.const ":"))))))

  (func $xmlScanName
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (br_if $done (i32.eqz (call $xmlNameChar (i32.load8_u (global.get $ptr)))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l))))

  ;; quoted attribute value starting at the quote
  (func $xmlQuoted
    (local $lhs i32)
    (local $p i32)
    (local.set $lhs (global.get $ptr))
    (local.set $p (call $lexFindByte
      (i32.add (global.get $ptr) (i32.const 1)) (i32.load8_u (global.get $ptr))))
    (global.set $ptr (select
      (i32.add (local.get $p) (i32.const 1)) (global.get $end)
      (i32.lt_u (local.get $p) (global.get $end))))
    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr)))

  ;; Scan a comment, CDATA section, or processing instruction. $kind is
  ;; 1=`-->`, 2=`]]>`, 3=`?>`; the opener has already been recognized.
  (func $xmlSection (param $lhs i32) (param $skip i32) (param $kind i32) (param $hl i32)
    (local $closed i32)
    (local $closeMask i32)
    (local $closeOff i32)
    (local $closeWord i32)
    (local $hit i32)
    (local $mask i32)
    (local $rem i32)
    (local $w v128)
    ;; hoist the packed close delimiter: each `>` candidate then costs one
    ;; masked load and compare, whatever the kind
    (if (i32.eq (local.get $kind) (i32.const 3))
      (then
        (local.set $closeWord (i32.const "?>"))
        (local.set $closeMask (i32.const 0xffff))
        (local.set $closeOff (i32.const 1)))
      (else
        (local.set $closeWord (select (i32.const "-->") (i32.const "]]>")
          (i32.eq (local.get $kind) (i32.const 1))))
        (local.set $closeMask (i32.const 0xffffff))
        (local.set $closeOff (i32.const 2))))
    (global.set $ptr (i32.add (global.get $ptr) (local.get $skip)))
    (if (i32.gt_u (global.get $ptr) (global.get $end))
      (then (global.set $ptr (global.get $end))))
    (block $done
      (loop $wide
        (if (i32.ge_u (global.get $ptr) (global.get $end))
          (then
            (global.set $ptr (global.get $end))
            (br $done)))
        (local.set $rem (i32.sub (global.get $end) (global.get $ptr)))
        (local.set $w (v128.load (global.get $ptr)))
        (local.set $mask (i8x16.bitmask
          (i8x16.eq (local.get $w) (i8x16.splat (i32.const ">")))))
        (if (i32.lt_u (local.get $rem) (i32.const 16))
          (then
            (local.set $mask (i32.and (local.get $mask)
              (i32.sub (i32.shl (i32.const 1) (local.get $rem)) (i32.const 1))))))
        (block $chunkDone
          (loop $hits
            (br_if $chunkDone (i32.eqz (local.get $mask)))
            (local.set $hit (i32.add (global.get $ptr) (i32.ctz (local.get $mask))))
            (if (i32.eq
                  (i32.and
                    (i32.load (i32.sub (local.get $hit) (local.get $closeOff)))
                    (local.get $closeMask))
                  (local.get $closeWord))
              (then
                (global.set $ptr (i32.add (local.get $hit) (i32.const 1)))
                (local.set $closed (i32.const 1))
                (br $done)))
            (local.set $mask (i32.and (local.get $mask)
              (i32.sub (local.get $mask) (i32.const 1))))
            (br $hits)))
        (if (i32.le_u (local.get $rem) (i32.const 16))
          (then
            (global.set $ptr (global.get $end))
            (br $done)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 16)))
        (br $wide)))
    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
    (if (i32.eqz (local.get $closed))
      (then
        (call $streamSetFixed32
          (local.get $closeWord)
          (i32.add (local.get $closeOff) (i32.const 1))
          (local.get $hl)))))

  ;; XML declarations may contain an internal subset. Only a `>` outside
  ;; quotes and square brackets ends the declaration.
  (func $xmlDoctype (param $lhs i32)
    (local $c i32)
    (local $depth i32)
    (local $quote i32)
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (local.get $quote)
          (then
            (if (i32.eq (local.get $c) (local.get $quote))
              (then (local.set $quote (i32.const 0)))))
          (else
            (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                        (i32.eq (local.get $c) (i32.const 39)))
              (then (local.set $quote (local.get $c)))
              (else
                (if (i32.eq (local.get $c) (i32.const "["))
                  (then (local.set $depth (i32.add (local.get $depth) (i32.const 1))))
                  (else
                    (if (i32.and (i32.eq (local.get $c) (i32.const "]"))
                                 (i32.gt_u (local.get $depth) (i32.const 0)))
                      (then (local.set $depth (i32.sub (local.get $depth) (i32.const 1))))
                      (else
                        (if (i32.and (i32.eqz (local.get $depth))
                                     (i32.eq (local.get $c) (i32.const ">")))
                          (then
                            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                            (br $done)))))))))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l)))
    (call $emitTok (enum.get $Token.tag.doctype) (local.get $lhs) (global.get $ptr)))

  (func $xmlEntity (result i32)
    (local $lhs i32)
    (local $c i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (block $bad
      (loop $l
        (br_if $bad (i32.ge_u (global.get $ptr) (global.get $end)))
        (br_if $bad (i32.gt_u (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 32)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const ";"))
          (then
            (if (i32.eq (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1)))
              (then (br $bad)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (global.get $ptr))
            (return (i32.const 1))))
        (br_if $bad (i32.eqz (i32.or
          (call $lexIsIdentContinue (local.get $c))
          (i32.eq (local.get $c) (i32.const "#")))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l)))
    (global.set $ptr (local.get $lhs))
    (i32.const 0))

  (func $xmlAttrs
    (local $c i32)
    (local $lhs i32)
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (call $lexScanWhitespace)
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const ">"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
            (br $done)))
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "/"))
              (i32.and
                (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
                (i32.eq (i32.load8_u offset=1 (global.get $ptr)) (i32.const ">"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
            (br $done)))
        (if (i32.eq (local.get $c) (i32.const "="))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter.html) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                    (i32.eq (local.get $c) (i32.const 39)))
          (then (call $xmlQuoted) (br $next)))
        (if (call $xmlNameStart (local.get $c))
          (then
            (call $xmlScanName)
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; Malformed unquoted attribute value or stray punctuation.
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (block $valueDone
          (loop $value
            (br_if $valueDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $valueDone (call $lexIsSpace (local.get $c)))
            (br_if $valueDone (i32.or (i32.eq (local.get $c) (i32.const ">"))
                                      (i32.eq (local.get $c) (i32.const "<"))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $value)))
        (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
        (br $next))))

  (func $hlXml
    (local $c i32)
    (local $lhs i32)
    (local $name i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (global.set $ptr (call $lexFindEither
          (global.get $ptr) (i32.const "<") (i32.const "&")))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const "&"))
          (then
            (if (i32.eqz (call $xmlEntity))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))))
            (br $next)))

        ;; Exact, case-sensitive XML openers.
        (if (i32.and
              (i32.le_u (i32.add (global.get $ptr) (i32.const 4)) (global.get $end))
              (i32.eq (i32.load (global.get $ptr)) (i32.const "<!--")))
          (then
            (call $xmlSection (local.get $lhs) (i32.const 4) (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.and
              (i32.le_u (i32.add (global.get $ptr) (i32.const 9)) (global.get $end))
              (i32.and
                (i64.eq (i64.load (global.get $ptr)) (i64.const "<![CDATA"))
                (i32.eq (i32.load8_u offset=8 (global.get $ptr)) (i32.const "["))))
          (then
            (call $xmlSection (local.get $lhs) (i32.const 9) (i32.const 2) (enum.get $Token.text.literal))
            (br $next)))
        (if (i32.and
              (i32.le_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
              (i32.eq (i32.and (i32.load (global.get $ptr)) (i32.const 0xffff)) (i32.const "<?")))
          (then
            (call $xmlSection (local.get $lhs) (i32.const 2) (i32.const 3) (enum.get $Token.preproc))
            (br $next)))
        (if (i32.and
              (i32.le_u (i32.add (global.get $ptr) (i32.const 9)) (global.get $end))
              (i32.and
                (i64.eq (i64.load (global.get $ptr)) (i64.const "<!DOCTYP"))
                (i32.eq (i32.load8_u offset=8 (global.get $ptr)) (i32.const "E"))))
          (then (call $xmlDoctype (local.get $lhs)) (br $next)))

        ;; Ordinary tags. XML names are emitted verbatim and compared nowhere,
        ;; so `<Foo>` and `<foo>` remain distinct and raw-text HTML rules never apply.
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (if (i32.and
              (i32.lt_u (global.get $ptr) (global.get $end))
              (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "/")))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (local.set $name (global.get $ptr))
        (if (i32.and
              (i32.lt_u (global.get $ptr) (global.get $end))
              (call $xmlNameStart (i32.load8_u (global.get $ptr))))
          (then
            (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (local.get $name))
            (call $xmlScanName)
            (call $emitTok (enum.get $Token.tag) (local.get $name) (global.get $ptr))
            (call $xmlAttrs)
            (br $next)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
