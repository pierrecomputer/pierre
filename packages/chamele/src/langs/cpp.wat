(module
  (import "../common.wat")

  ;; A bounded byte read for prefix and operator lookahead.
  (func $cppByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  (func $cppIsOp (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
        (i32.or (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $c) (i32.const "/"))))
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "%")) (i32.eq (local.get $c) (i32.const "=")))
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "!")) (i32.eq (local.get $c) (i32.const "<")))
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const ">")) (i32.eq (local.get $c) (i32.const "&")))
            (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const "^")))
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const "~")) (i32.eq (local.get $c) (i32.const "?")))
                (i32.eq (local.get $c) (i32.const "#")))))))))

  ;; C++ numeric preprocessing token: radix digits, digit separators,
  ;; exponents and user-defined/type suffixes stay in one allocation-free run.
  (func $cppScanNumber
    (local $c i32)
    (local $prev i32)
    (local $dot i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (call $lexIsIdentContinue (local.get $c))
          (then
            (local.set $prev (local.get $c))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $l)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (local.set $prev (local.get $c))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $l)))
        (if (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.eqz (local.get $dot)))
          (then
            (local.set $dot (i32.const 1))
            (local.set $prev (local.get $c))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $l)))
        (if (i32.and
              (i32.or (i32.eq (local.get $c) (i32.const "+"))
                      (i32.eq (local.get $c) (i32.const "-")))
              (i32.or
                (i32.eq (i32.or (local.get $prev) (i32.const 32)) (i32.const "e"))
                (i32.eq (i32.or (local.get $prev) (i32.const 32)) (i32.const "p"))))
          (then
            (local.set $prev (local.get $c))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $l)))
        (br $done))))

  ;; Return quote-offset+1 in the low byte and bit 8 for a raw literal.
  ;; Zero means the bytes begin an ordinary identifier instead.
  (func $cppStringKind (param $p i32) (result i32)
    (local $c i32)
    (local $n i32)
    (local.set $c (call $cppByte (local.get $p)))
    (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                (i32.eq (local.get $c) (i32.const 39)))
      (then (return (i32.const 1))))
    (local.set $n (call $cppByte (i32.add (local.get $p) (i32.const 1))))
    (if (i32.and (i32.eq (local.get $c) (i32.const "R"))
                 (i32.eq (local.get $n) (i32.const 34)))
      (then (return (i32.const 258))))
    (if (i32.and (i32.eq (local.get $c) (i32.const "u"))
                 (i32.eq (local.get $n) (i32.const "8")))
      (then
        (local.set $n (call $cppByte (i32.add (local.get $p) (i32.const 2))))
        (if (i32.or (i32.eq (local.get $n) (i32.const 34))
                    (i32.eq (local.get $n) (i32.const 39)))
          (then (return (i32.const 3))))
        (if (i32.and (i32.eq (local.get $n) (i32.const "R"))
                     (i32.eq (call $cppByte (i32.add (local.get $p) (i32.const 3))) (i32.const 34)))
          (then (return (i32.const 260))))))
    (if (i32.and
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const "L"))
                    (i32.eq (local.get $c) (i32.const "u")))
            (i32.eq (local.get $c) (i32.const "U")))
          (i32.or
            (i32.or (i32.eq (local.get $n) (i32.const 34))
                    (i32.eq (local.get $n) (i32.const 39)))
            (i32.and (i32.eq (local.get $n) (i32.const "R"))
                     (i32.eq (call $cppByte (i32.add (local.get $p) (i32.const 2))) (i32.const 34)))))
      (then
        (return (select (i32.const 259) (i32.const 2)
          (i32.eq (local.get $n) (i32.const "R"))))))
    (i32.const 0))

  ;; Emit a prefixed ordinary or raw literal. Ordinary strings use a 16-byte
  ;; scan and split C++ escape forms; raw strings search `)` candidates 16 at
  ;; a time and verify their exact, at-most-16-byte delimiter.
  (func $cppString (param $lhs i32) (param $kind i32)
    (local $quote i32)
    (local $q i32)
    (local $d i32)
    (local $dlen i32)
    (local $p i32)
    (local $e i32)
    (local $seg i32)
    (local $c i32)
    (local $c2 i32)
    (local $k i32)
    (local $match i32)
    (local $mask i32)
    (local $rem i32)
    (local $hl i32)
    (local $w v128)
    (local.set $quote (i32.add (local.get $lhs)
      (i32.sub (i32.and (local.get $kind) (i32.const 255)) (i32.const 1))))

    (block $ordinary
      (if (i32.and (local.get $kind) (i32.const 256))
        (then
          ;; Read the raw delimiter up to its opening `(`.
          (local.set $d (i32.add (local.get $quote) (i32.const 1)))
          (local.set $p (local.get $d))
          (block $delimiter
            (loop $dl
              (br_if $ordinary (i32.ge_u (local.get $p) (global.get $end)))
              (local.set $c (i32.load8_u (local.get $p)))
              (br_if $delimiter (i32.eq (local.get $c) (i32.const "(")))
              (br_if $ordinary (i32.or
                (i32.or (i32.le_u (local.get $c) (i32.const 32))
                        (i32.eq (local.get $c) (i32.const ")")))
                (i32.or (i32.eq (local.get $c) (i32.const 92))
                        (i32.ge_u (i32.sub (local.get $p) (local.get $d)) (i32.const 16)))))
              (local.set $p (i32.add (local.get $p) (i32.const 1)))
              (br $dl)))
          (local.set $dlen (i32.sub (local.get $p) (local.get $d)))
          (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
          (block $rawDone
            (loop $raw
              (br_if $rawDone (i32.ge_u (global.get $ptr) (global.get $end)))
              (local.set $w (v128.load (global.get $ptr)))
              (local.set $mask (i8x16.bitmask
                (i8x16.eq (local.get $w) (i8x16.splat (i32.const ")")))))
              (local.set $rem (i32.sub (global.get $end) (global.get $ptr)))
              (if (i32.lt_u (local.get $rem) (i32.const 16))
                (then (local.set $mask (i32.and (local.get $mask)
                  (i32.sub (i32.shl (i32.const 1) (local.get $rem)) (i32.const 1))))))
              (block $advance
                (loop $candidate
                  (br_if $advance (i32.eqz (local.get $mask)))
                  (local.set $q (i32.add (global.get $ptr) (i32.ctz (local.get $mask))))
                  (if (i32.le_u
                        (i32.add (local.get $q) (i32.add (local.get $dlen) (i32.const 2)))
                        (global.get $end))
                    (then
                      (local.set $match (i32.const 1))
                      (local.set $k (i32.const 0))
                      (block $cmpDone
                        (loop $cmp
                          (br_if $cmpDone (i32.ge_u (local.get $k) (local.get $dlen)))
                          (if (i32.ne
                                (i32.load8_u (i32.add (i32.add (local.get $q) (i32.const 1)) (local.get $k)))
                                (i32.load8_u (i32.add (local.get $d) (local.get $k))))
                            (then
                              (local.set $match (i32.const 0))
                              (br $cmpDone)))
                          (local.set $k (i32.add (local.get $k) (i32.const 1)))
                          (br $cmp)))
                      (if (i32.and (local.get $match)
                            (i32.eq
                              (i32.load8_u (i32.add (i32.add (local.get $q) (local.get $dlen)) (i32.const 1)))
                              (i32.const 34)))
                        (then
                          (global.set $ptr
                            (i32.add (local.get $q) (i32.add (local.get $dlen) (i32.const 2))))
                          (if (call $lexIsIdentStart (call $cppByte (global.get $ptr)))
                            (then (call $lexScanIdent)))
                          (call $emitTok (enum.get $Token.string)
                            (local.get $lhs) (global.get $ptr))
                          (return)))))
                  (local.set $mask (i32.and (local.get $mask)
                    (i32.sub (local.get $mask) (i32.const 1))))
                  (br $candidate)))
              (if (i32.le_u (local.get $rem) (i32.const 16))
                (then
                  (global.set $ptr (global.get $end))
                  (br $rawDone)))
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 16)))
              (br $raw)))
          (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
          (if (i32.eq (global.get $ptr) (global.get $end))
            (then
              (i32.store8 (i32.const $mem.streamDelimiter) (i32.const ")"))
              (memory.copy
                (i32.const $mem.streamDelimiter+1) (local.get $d) (local.get $dlen))
              (i32.store8
                (i32.add (i32.const $mem.streamDelimiter+1) (local.get $dlen))
                (i32.const 34))
              (call $streamSetFixed
                (i32.const $mem.streamDelimiter)
                (i32.add (local.get $dlen) (i32.const 2))
                (enum.get $Token.string))))
          (return))))

    ;; An invalid raw prefix falls back to an ordinary quoted literal. This is
    ;; lenient, bounded, and still colors its leading R/u8R prefix as string.
    (local.set $q (i32.load8_u (local.get $quote)))
    (local.set $hl (select (enum.get $Token.number) (enum.get $Token.string)
      (i32.eq (local.get $q) (i32.const 39))))
    (local.set $seg (local.get $lhs))
    (global.set $ptr (i32.add (local.get $quote) (i32.const 1)))
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $w (v128.load (global.get $ptr)))
        (local.set $mask (i8x16.bitmask (v128.or
          (v128.or
            (i8x16.eq (local.get $w) (i8x16.splat (local.get $q)))
            (i8x16.eq (local.get $w) (i8x16.splat (i32.const 92))))
          (v128.or
            (i8x16.eq (local.get $w) (i8x16.splat (i32.const 10)))
            (i8x16.eq (local.get $w) (i8x16.splat (i32.const 13)))))))
        (local.set $rem (i32.sub (global.get $end) (global.get $ptr)))
        (if (i32.lt_u (local.get $rem) (i32.const 16))
          (then (local.set $mask (i32.and (local.get $mask)
            (i32.sub (i32.shl (i32.const 1) (local.get $rem)) (i32.const 1))))))
        (if (i32.eqz (local.get $mask))
          (then
            (if (i32.le_u (local.get $rem) (i32.const 16))
              (then
                (global.set $ptr (global.get $end))
                (br $done)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 16)))
            (br $scan)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.ctz (local.get $mask))))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $q))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (call $lexIsIdentStart (call $cppByte (global.get $ptr)))
              (then (call $lexScanIdent)))
            (br $done)))
        (br_if $done (i32.or (i32.eq (local.get $c) (i32.const 10))
                             (i32.eq (local.get $c) (i32.const 13))))

        ;; Escape endpoint: fixed-width Unicode, arbitrary hex (bounded here
        ;; to a generous run), octal, named Unicode, or one whole UTF-8 char.
        (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
        (local.set $c2 (call $cppByte (i32.add (global.get $ptr) (i32.const 1))))
        (if (i32.eq (local.get $c2) (i32.const "u"))
          (then (local.set $e (call $scanHexRun
            (i32.add (global.get $ptr) (i32.const 2)) (i32.const 4))))
          (else
            (if (i32.eq (local.get $c2) (i32.const "U"))
              (then (local.set $e (call $scanHexRun
                (i32.add (global.get $ptr) (i32.const 2)) (i32.const 8))))
              (else
                (if (i32.eq (local.get $c2) (i32.const "x"))
                  (then (local.set $e (call $scanHexRun
                    (i32.add (global.get $ptr) (i32.const 2)) (i32.const 64))))
                  (else
                    (if (i32.and
                          (i32.eq (local.get $c2) (i32.const "N"))
                          (i32.eq (call $cppByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const "{")))
                      (then
                        (local.set $e (i32.add (global.get $ptr) (i32.const 3)))
                        (block $namedDone
                          (loop $named
                            (br_if $namedDone (i32.ge_u (local.get $e) (global.get $end)))
                            (if (i32.eq (i32.load8_u (local.get $e)) (i32.const "}"))
                              (then
                                (local.set $e (i32.add (local.get $e) (i32.const 1)))
                                (br $namedDone)))
                            (local.set $e (i32.add (local.get $e) (i32.const 1)))
                            (br $named))))
                      (else
                        (if (i32.le_u (i32.sub (local.get $c2) (i32.const "0")) (i32.const 7))
                          (then
                            (local.set $e (i32.add (global.get $ptr) (i32.const 1)))
                            (local.set $k (i32.const 0))
                            (block $octDone
                              (loop $oct
                                (br_if $octDone (i32.or
                                  (i32.ge_u (local.get $e) (global.get $end))
                                  (i32.ge_u (local.get $k) (i32.const 3))))
                                (br_if $octDone (i32.gt_u
                                  (i32.sub (i32.load8_u (local.get $e)) (i32.const "0")) (i32.const 7)))
                                (local.set $e (i32.add (local.get $e) (i32.const 1)))
                                (local.set $k (i32.add (local.get $k) (i32.const 1)))
                                (br $oct))))
                          (else
                            (local.set $e (i32.add (global.get $ptr) (i32.const 2)))
                            (if (i32.and (i32.eq (local.get $c2) (i32.const 13))
                                         (i32.eq (call $cppByte (local.get $e)) (i32.const 10)))
                              (then (local.set $e (i32.add (local.get $e) (i32.const 1)))))))))))))))
        (if (i32.gt_u (local.get $e) (global.get $end))
          (then (local.set $e (global.get $end))))
        (block $utf8Done
          (loop $utf8
            (br_if $utf8Done (i32.ge_u (local.get $e) (global.get $end)))
            (br_if $utf8Done (i32.ne
              (i32.and (i32.load8_u (local.get $e)) (i32.const 0xc0)) (i32.const 0x80)))
            (local.set $e (i32.add (local.get $e) (i32.const 1)))
            (br $utf8)))
        (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
        (global.set $ptr (local.get $e))
        (local.set $seg (local.get $e))
        (br $scan)))
    (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr)))

  ;; Exact keyword comparison for up to sixteen bytes. Inputs have sentinel
  ;; slack, making both unaligned i64 loads safe; masks discard bytes past the
  ;; identifier itself.
  (func $cppWordEq (param $lhs i32) (param $rhs i32) (param $n i32)
      (param $a i64) (param $b i64) (result i32)
    (local $rem i32)
    (local $mask i64)
    (if (i32.ne (i32.sub (local.get $rhs) (local.get $lhs)) (local.get $n))
      (then (return (i32.const 0))))
    (if (i32.le_u (local.get $n) (i32.const 8))
      (then
        (if (i32.eq (local.get $n) (i32.const 8))
          (then (return (i64.eq (i64.load (local.get $lhs)) (local.get $a)))))
        (local.set $mask (i64.sub
          (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $n) (i32.const 3))))
          (i64.const 1)))
        (return (i64.eq (i64.and (i64.load (local.get $lhs)) (local.get $mask)) (local.get $a)))))
    (if (i64.ne (i64.load (local.get $lhs)) (local.get $a))
      (then (return (i32.const 0))))
    (local.set $rem (i32.sub (local.get $n) (i32.const 8)))
    (if (i32.eq (local.get $rem) (i32.const 8))
      (then (return (i64.eq (i64.load offset=8 (local.get $lhs)) (local.get $b)))))
    (local.set $mask (i64.sub
      (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $rem) (i32.const 3))))
      (i64.const 1)))
    (i64.eq (i64.and (i64.load offset=8 (local.get $lhs)) (local.get $mask)) (local.get $b)))

  ;; Token in the low byte. Bits 8/9 request type.class/type for the next
  ;; non-keyword identifier. -1 means an ordinary identifier.
  (func $cppWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))

    ;; control flow
    (if (i32.le_u (local.get $n) (i32.const 8))
      (then
        (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 2) (i64.const "if") (i64.const 0))
          (then (return (enum.get $Token.keyword.control))))
        (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 2) (i64.const "do") (i64.const 0))
          (then (return (enum.get $Token.keyword.control))))
        (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "for") (i64.const 0))
          (then (return (enum.get $Token.keyword.control))))
        (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "try") (i64.const 0))
          (then (return (enum.get $Token.keyword.control))))
        (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "else") (i64.const 0))
          (then (return (enum.get $Token.keyword.control))))
        (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "case") (i64.const 0))
          (then (return (enum.get $Token.keyword.control))))
        (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "goto") (i64.const 0))
          (then (return (enum.get $Token.keyword.control))))
        (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "while") (i64.const 0))
          (then (return (enum.get $Token.keyword.control))))
        (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "break") (i64.const 0))
          (then (return (enum.get $Token.keyword.control))))
        (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "catch") (i64.const 0))
          (then (return (enum.get $Token.keyword.control))))
        (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "throw") (i64.const 0))
          (then (return (enum.get $Token.keyword.control))))
        (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "switch") (i64.const 0))
          (then (return (enum.get $Token.keyword.control))))
        (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "return") (i64.const 0))
          (then (return (enum.get $Token.keyword.control))))
        (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "default") (i64.const 0))
          (then (return (enum.get $Token.keyword.control))))
        (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "continue") (i64.const 0))
          (then (return (enum.get $Token.keyword.control))))
        (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "co_await") (i64.const 0))
          (then (return (enum.get $Token.keyword.control))))
        (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "co_yield") (i64.const 0))
          (then (return (enum.get $Token.keyword.control))))))
    (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 9)
          (i64.const "co_retur") (i64.const "n"))
      (then (return (enum.get $Token.keyword.control))))

    ;; aggregate/declaration words; the high byte selects the next-name capture:
    ;; 1=type.class, 2=type, 3=namespace.
    (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "class") (i64.const 0))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 256)))))
    (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "union") (i64.const 0))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 256)))))
    (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "struct") (i64.const 0))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 256)))))
    (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "enum") (i64.const 0))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 512)))))
    (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "using") (i64.const 0))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 512)))))
    (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "typedef") (i64.const 0))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 512)))))
    (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "concept") (i64.const 0))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 512)))))
    (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "template") (i64.const 0))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 9)
          (i64.const "namespac") (i64.const "e"))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 768)))))
    (if (i32.or
          (i32.or
            (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "extern") (i64.const 0))
            (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "inline") (i64.const 0)))
          (i32.or
            (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "static") (i64.const 0))
            (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "register") (i64.const 0))))
      (then (return (enum.get $Token.keyword.declaration))))

    ;; modules
    (if (i32.or
          (i32.or
            (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "import") (i64.const 0))
            (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "module") (i64.const 0)))
          (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "export") (i64.const 0)))
      (then (return (enum.get $Token.keyword.import))))

    ;; primitive types
    (if (i32.or
          (i32.or
            (i32.or
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "int") (i64.const 0))
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "auto") (i64.const 0)))
            (i32.or
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "bool") (i64.const 0))
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "char") (i64.const 0))))
          (i32.or
            (i32.or
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "long") (i64.const 0))
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "void") (i64.const 0)))
            (i32.or
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "float") (i64.const 0))
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "short") (i64.const 0)))))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (i32.or
            (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "double") (i64.const 0))
            (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "signed") (i64.const 0)))
          (i32.or
            (i32.or
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "char8_t") (i64.const 0))
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "wchar_t") (i64.const 0)))
            (i32.or
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "char16_t") (i64.const 0))
              (i32.or
                (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "char32_t") (i64.const 0))
                (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "unsigned") (i64.const 0))))))
      (then (return (enum.get $Token.type.builtin))))

    ;; literal/special words and alternative operator spellings
    (if (i32.or
          (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "true") (i64.const 0))
          (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "false") (i64.const 0)))
      (then (return (enum.get $Token.boolean))))
    (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "nullptr") (i64.const 0))
      (then (return (enum.get $Token.constant.builtin))))
    (if (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "this") (i64.const 0))
      (then (return (enum.get $Token.variable.special))))
    (if (i32.or
          (i32.or
            (i32.or
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 2) (i64.const "or") (i64.const 0))
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "and") (i64.const 0)))
            (i32.or
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "not") (i64.const 0))
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "xor") (i64.const 0))))
          (i32.or
            (i32.or
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "bitor") (i64.const 0))
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "compl") (i64.const 0)))
            (i32.or
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "or_eq") (i64.const 0))
              (i32.or
                (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "and_eq") (i64.const 0))
                (i32.or
                  (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "bitand") (i64.const 0))
                  (i32.or
                    (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "not_eq") (i64.const 0))
                    (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "xor_eq") (i64.const 0))))))))
      (then (return (enum.get $Token.operator))))

    ;; remaining C++ keywords, including casts and specifiers
    (if (i32.or
          (i32.or
            (i32.or
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "asm") (i64.const 0))
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "new") (i64.const 0)))
            (i32.or
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "const") (i64.const 0))
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "final") (i64.const 0))))
          (i32.or
            (i32.or
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "delete") (i64.const 0))
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "friend") (i64.const 0)))
            (i32.or
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "public") (i64.const 0))
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "sizeof") (i64.const 0)))))
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (i32.or
            (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "alignas") (i64.const 0))
            (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "alignof") (i64.const 0)))
          (i32.or
            (i32.or
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "mutable") (i64.const 0))
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "private") (i64.const 0)))
            (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "virtual") (i64.const 0))))
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (i32.or
            (i32.or
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "decltype") (i64.const 0))
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "explicit") (i64.const 0)))
            (i32.or
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "noexcept") (i64.const 0))
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "operator") (i64.const 0))))
          (i32.or
            (i32.or
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "override") (i64.const 0))
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "requires") (i64.const 0)))
            (i32.or
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "typename") (i64.const 0))
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "volatile") (i64.const 0)))))
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (i32.or
            (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 9) (i64.const "consteva") (i64.const "l"))
            (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 9) (i64.const "constexp") (i64.const "r")))
          (i32.or
            (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 9) (i64.const "constini") (i64.const "t"))
            (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 9) (i64.const "protecte") (i64.const "d"))))
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (i32.or
            (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 10) (i64.const "const_ca") (i64.const "st"))
            (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 11) (i64.const "static_c") (i64.const "ast")))
          (i32.or
            (i32.or
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 12) (i64.const "dynamic_") (i64.const "cast"))
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 12) (i64.const "thread_l") (i64.const "ocal")))
            (i32.or
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 13) (i64.const "static_a") (i64.const "ssert"))
              (call $cppWordEq (local.get $lhs) (local.get $rhs) (i32.const 16) (i64.const "reinterp") (i64.const "ret_cast")))))
      (then (return (enum.get $Token.keyword))))
    (i32.const -1))

  (func $hlCpp
    (local $c i32)
    (local $c2 i32)
    (local $c3 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $kind i32)
    (local $hl i32)
    (local $bol i32)
    (local $expectType i32)
    (local $member i32) ;; 1 after ./->, 2 after ::
    (call $lexEmitLeadingContinuation)
    (local.set $bol (i32.const 1))
    (block $done
      (loop $next
        ;; Whitespace remains a gap; track whether only horizontal space has
        ;; occurred since the latest physical newline for directives.
        (local.set $gap (global.get $ptr))
        (block $wsDone
          (loop $ws
            (br_if $wsDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $wsDone (i32.eqz (call $lexIsSpace (local.get $c))))
            (if (i32.or (i32.eq (local.get $c) (i32.const 10))
                        (i32.eq (local.get $c) (i32.const 13)))
              (then (local.set $bol (i32.const 1))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $ws)))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $cppByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $cppByte (i32.add (global.get $ptr) (i32.const 2))))

        ;; comments, including Doxygen-style documentation comments
        (if (i32.and (i32.eq (local.get $c) (i32.const "/"))
                     (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2)
              (select (enum.get $Token.comment.doc) (enum.get $Token.comment)
                (i32.or (i32.eq (local.get $c3) (i32.const "/"))
                        (i32.eq (local.get $c3) (i32.const "!")))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/"))
                     (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2)
              (select (enum.get $Token.comment.doc) (enum.get $Token.comment)
                (i32.or
                  (i32.eq (local.get $c3) (i32.const "!"))
                  (i32.and (i32.eq (local.get $c3) (i32.const "*"))
                    (i32.ne (call $cppByte (i32.add (local.get $lhs) (i32.const 3))) (i32.const "/"))))))
            (br $next)))

        ;; A directive owns its logical line, including escaped newlines.
        (if (i32.and (local.get $bol) (i32.eq (local.get $c) (i32.const "#")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (block $directiveDone
              (loop $directive
                (call $scanToLineEnd)
                (br_if $directiveDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (br_if $directiveDone (i32.or
                  (i32.eq (global.get $ptr) (local.get $lhs))
                  (i32.ne (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 92))))
                (if (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 13))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (if (i32.eq (call $cppByte (global.get $ptr)) (i32.const 10))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (br $directive)))
            (if (i32.eqz (call $lexEmitIncludeDirective (local.get $lhs) (global.get $ptr)))
              (then (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))))
            (local.set $bol (i32.const 0))
            (local.set $member (i32.const 0))
            (local.set $expectType (i32.const 0))
            (br $next)))

        ;; ordinary/prefixed/raw strings and character literals
        (local.set $kind (call $cppStringKind (global.get $ptr)))
        (if (local.get $kind)
          (then
            (call $cppString (local.get $lhs) (local.get $kind))
            (local.set $bol (i32.const 0))
            (local.set $member (i32.const 0))
            (local.set $expectType (i32.const 0))
            (br $next)))

        ;; identifiers and contextual function/type/member heuristics
        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (local.set $kind (call $cppWordHl (local.get $lhs) (local.get $rhs)))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (if (i32.shr_u (local.get $kind) (i32.const 8))
                  (then (local.set $expectType (i32.shr_u (local.get $kind) (i32.const 8))))))
              (else
                (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
                (if (local.get $expectType)
                  (then
                    (local.set $hl
                      (select (enum.get $Token.type.class)
                        (select (enum.get $Token.namespace) (enum.get $Token.type)
                          (i32.eq (local.get $expectType) (i32.const 3)))
                        (i32.eq (local.get $expectType) (i32.const 1))))
                    (local.set $expectType (i32.const 0)))
                  (else
                    (if (i32.eq (call $cppByte (local.get $p)) (i32.const "("))
                      (then (local.set $hl (select
                        (enum.get $Token.function.method) (enum.get $Token.function)
                        (local.get $member))))
                      (else
                        (if (i32.eq (local.get $member) (i32.const 1))
                          (then (local.set $hl (enum.get $Token.property)))
                          (else
                            (if (i32.or
                                  (i32.eq (local.get $member) (i32.const 2))
                                  (i32.and
                                    (i32.eq (call $cppByte (local.get $p)) (i32.const ":"))
                                    (i32.eq (call $cppByte (i32.add (local.get $p) (i32.const 1))) (i32.const ":"))))
                              (then (local.set $hl
                                (select (enum.get $Token.namespace) (enum.get $Token.type)
                                  (i32.and
                                    (i32.eq (call $cppByte (local.get $p)) (i32.const ":"))
                                    (i32.eq (call $cppByte (i32.add (local.get $p) (i32.const 1)))
                                            (i32.const ":"))))))
                              (else
                                (if (i32.and
                                      (i32.eq (call $cppByte (local.get $p)) (i32.const ":"))
                                      (i32.ne (call $cppByte (i32.add (local.get $p) (i32.const 1))) (i32.const ":")))
                                  (then (local.set $hl (enum.get $Token.label)))
                                  (else
                                    (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                                      (then (local.set $hl (enum.get $Token.constant)))
                                      (else
                                        (if (i32.le_u
                                              (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A"))
                                              (i32.const 25))
                                          (then (local.set $hl (enum.get $Token.type)))
                                          (else (local.set $hl (enum.get $Token.variable))))))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $bol (i32.const 0))
            (local.set $member (i32.const 0))
            (br $next)))

        ;; numeric literals, including .5, binary/hex floats and separators
        (if (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and (i32.eq (local.get $c) (i32.const "."))
                       (call $lexIsDigit (local.get $c2))))
          (then
            (call $cppScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $bol (i32.const 0))
            (local.set $member (i32.const 0))
            (br $next)))

        ;; brackets
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const ")")))
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "]")))
                (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $bol (i32.const 0))
            (local.set $member (i32.const 0))
            (if (i32.or (i32.eq (local.get $c) (i32.const "{"))
                        (i32.eq (local.get $c) (i32.const "}")))
              (then (local.set $expectType (i32.const 0))))
            (br $next)))

        ;; scope/member delimiters and ellipsis/pointer-to-member operators
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (global.set $ptr (i32.add (global.get $ptr)
              (select (i32.const 2) (i32.const 1) (i32.eq (local.get $c2) (i32.const ":")))))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (select (i32.const 2) (i32.const 0)
              (i32.eq (local.get $c2) (i32.const ":"))))
            (local.set $bol (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (if (i32.or (i32.eq (local.get $c2) (i32.const "*"))
                        (i32.and (i32.eq (local.get $c2) (i32.const "."))
                                 (i32.eq (local.get $c3) (i32.const "."))))
              (then
                (global.set $ptr (i32.add (global.get $ptr)
                  (select (i32.const 3) (i32.const 2) (i32.eq (local.get $c2) (i32.const ".")))))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (local.set $member (i32.const 0)))
              (else
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
                (local.set $member (i32.const 1))))
            (local.set $bol (i32.const 0))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ","))
                    (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $bol (i32.const 0))
            (local.set $member (i32.const 0))
            (if (i32.eq (local.get $c) (i32.const ";"))
              (then (local.set $expectType (i32.const 0))))
            (br $next)))

        ;; Operators consume one valid compound form, leaving a following `/`
        ;; visible to the next iteration so it can still open a comment.
        (if (call $cppIsOp (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $member (i32.const 0))
            (if (i32.and (i32.eq (local.get $c) (i32.const "-"))
                         (i32.eq (local.get $c2) (i32.const ">")))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.eq (call $cppByte (global.get $ptr)) (i32.const "*"))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (local.set $member (i32.const 1)))
              (else
                (if (i32.and
                      (i32.eq (local.get $c) (i32.const "<"))
                      (i32.and (i32.eq (local.get $c2) (i32.const "="))
                               (i32.eq (local.get $c3) (i32.const ">"))))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 2))))
                  (else
                    (if (i32.or (i32.eq (local.get $c2) (i32.const "="))
                                (i32.eq (local.get $c) (local.get $c2)))
                      (then
                        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                        (if (i32.and
                              (i32.or (i32.eq (local.get $c) (i32.const "<"))
                                      (i32.eq (local.get $c) (i32.const ">")))
                              (i32.eq (call $cppByte (global.get $ptr)) (i32.const "=")))
                          (then
                            (global.set $ptr
                              (i32.add (global.get $ptr) (i32.const 1)))))))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $bol (i32.const 0))
            (br $next)))

        ;; Unknown bytes are plain; batch until the next recognized byte class.
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (block $plainDone
          (loop $plain
            (br_if $plainDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $plainDone (i32.or
              (i32.or
                (i32.or (call $lexIsSpace (local.get $c)) (call $lexIsIdentStart (local.get $c)))
                (i32.or (call $lexIsDigit (local.get $c)) (call $cppIsOp (local.get $c))))
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
                (i32.or
                  (i32.or
                    (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const ")")))
                    (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "]"))))
                  (i32.or
                    (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))
                    (i32.or
                      (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
                      (i32.or (i32.eq (local.get $c) (i32.const ":"))
                              (i32.eq (local.get $c) (i32.const ".")))))))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $plain)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $bol (i32.const 0))
        (local.set $member (i32.const 0))
        (br $next))))
)
