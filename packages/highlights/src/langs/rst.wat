(module
  (import "../common.wat")

  ;; Any byte of a non-ASCII code point counts, so `日本*語*` is no markup.
  (func $rstIsAlnum (param $c i32) (result i32)
    (i32.or
      (i32.ge_u (local.get $c) (i32.const 0x80))
      (i32.or
        (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
        (call $lexIsDigit (local.get $c)))))

  ;; End of the run of $n `$c` bytes that closes markup in [$p,$stop), after a
  ;; non-blank byte and, with $tight, before no letter or digit; 0 when none.
  (func $rstCloseEnd (param $p i32) (param $stop i32) (param $c i32) (param $n i32) (param $tight i32) (result i32)
    (local $q i32)
    (loop $find
      (local.set $p
        (call $scanFindSpecial (local.get $p) (local.get $stop) (local.get $c) (i32.const 0) (i32.const 0)))
      (if (i32.ge_u (local.get $p) (local.get $stop))
        (then (return (i32.const 0))))
      (local.set $q (i32.add (local.get $p) (local.get $n)))
      (if
        (i32.and
          (i32.and
            (i32.le_u (local.get $q) (local.get $stop))
            (i32.or
              (i32.eq (local.get $n) (i32.const 1))
              (i32.eq (i32.load8_u offset=1 (local.get $p)) (local.get $c))))
          (i32.and
            (i32.eqz (call $lexIsSpace (i32.load8_u (i32.sub (local.get $p) (i32.const 1)))))
            (i32.or
              (i32.eqz (local.get $tight))
              (i32.or
                (i32.ge_u (local.get $q) (local.get $stop))
                (i32.eqz (call $rstIsAlnum (i32.load8_u (local.get $q))))))))
        (then (return (local.get $q))))
      (local.set $p (i32.add (local.get $p) (i32.const 1)))
      (br $find))
    (i32.const 0))

  (func $rstTrimEnd (param $p i32) (param $stop i32) (result i32)
    (block $done
      (loop $trim
        (br_if $done (i32.le_u (local.get $stop) (local.get $p)))
        (br_if $done (i32.eqz (call $lexIsSpace (i32.load8_u (i32.sub (local.get $stop) (i32.const 1))))))
        (local.set $stop (i32.sub (local.get $stop) (i32.const 1)))
        (br $trim)))
    (local.get $stop))

  ;; 1 for a section adornment or transition, 2 for a simple table border.
  (func $rstIsRule (param $p i32) (param $stop i32) (result i32)
    (local $c i32)
    (local $q i32)
    (local $gaps i32)
    (local.set $c (i32.load8_u (local.get $p)))
    (if
      (i32.or
        (i32.lt_u (i32.sub (local.get $stop) (local.get $p)) (i32.const 3))
        (i32.or
          (i32.gt_u (i32.sub (local.get $c) (i32.const 33)) (i32.const 93))
          (call $rstIsAlnum (local.get $c))))
      (then (return (i32.const 0))))
    (local.set $q (i32.add (local.get $p) (i32.const 1)))
    (block $done
      (loop $run
        (br_if $done (i32.ge_u (local.get $q) (local.get $stop)))
        (if (i32.ne (i32.load8_u (local.get $q)) (local.get $c))
          (then
            (br_if $done
              (i32.or
                (i32.eqz (call $lexIsSpace (i32.load8_u (local.get $q))))
                (i32.and (i32.ne (local.get $c) (i32.const "=")) (i32.ne (local.get $c) (i32.const "-")))))
            (local.set $gaps (i32.const 1))))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $run)))
    (select (i32.add (local.get $gaps) (i32.const 1)) (i32.const 0) (i32.eq (local.get $q) (local.get $stop))))

  (func $rstLinkSuffix (param $p i32) (param $stop i32) (result i32)
    (local $n i32)
    (block $done
      (loop $count
        (br_if $done (i32.ge_u (i32.add (local.get $p) (local.get $n)) (local.get $stop)))
        (br_if $done (i32.ne (i32.load8_u (i32.add (local.get $p) (local.get $n))) (i32.const "_")))
        (local.set $n (i32.add (local.get $n) (i32.const 1)))
        (br_if $count (i32.lt_u (local.get $n) (i32.const 2)))))
    (local.get $n))

  ;; One SIMD pass per 16 bytes keeps plain prose one token.
  (func $rstPlainEnd (param $p i32) (param $stop i32) (param $a i32) (param $b i32) (param $c i32) (result i32)
    (local $mask i32)
    (local $w v128)
    (local $va v128)
    (local $vb v128)
    (local $vc v128)
    (if (i32.ge_u (local.get $p) (local.get $stop))
      (then (return (local.get $stop))))
    (local.set $va (i8x16.splat (local.get $a)))
    (local.set $vb (i8x16.splat (local.get $b)))
    (local.set $vc (i8x16.splat (local.get $c)))
    (block $done
      (loop $wide
        (local.set $w (v128.load (local.get $p)))
        (local.set $mask
          (i8x16.bitmask
            (v128.or
              (v128.or
                (v128.or
                  (i8x16.eq (local.get $w) (i8x16.splat (i32.const "*")))
                  (i8x16.eq (local.get $w) (i8x16.splat (i32.const "`"))))
                (v128.or
                  (i8x16.eq (local.get $w) (i8x16.splat (i32.const "|")))
                  (i8x16.eq (local.get $w) (i8x16.splat (i32.const 92)))))
              (v128.or
                (v128.or
                  (i8x16.eq (local.get $w) (i8x16.splat (i32.const ":")))
                  (i8x16.eq (local.get $w) (i8x16.splat (i32.const "_"))))
                (v128.or
                  (i8x16.eq (local.get $w) (local.get $va))
                  (v128.or
                    (i8x16.eq (local.get $w) (local.get $vb))
                    (i8x16.eq (local.get $w) (local.get $vc))))))))
        (if (local.get $mask)
          (then
            (local.set $p (i32.add (local.get $p) (i32.ctz (local.get $mask))))
            (br $done)))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br_if $wide (i32.lt_u (local.get $p) (local.get $stop)))))
    (select (local.get $p) (local.get $stop) (i32.lt_u (local.get $p) (local.get $stop))))

  (func $rstWordStart (param $lhs i32) (param $p i32) (result i32)
    (local $c i32)
    (block $done
      (loop $back
        (br_if $done (i32.le_u (local.get $p) (local.get $lhs)))
        (local.set $c (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))
        (br_if $done
          (i32.eqz
            (i32.or
              (i32.and (call $lexIsIdentContinue (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
              (i32.eq (local.get $c) (i32.const "-")))))
        (local.set $p (i32.sub (local.get $p) (i32.const 1)))
        (br $back)))
    (local.get $p))

  ;; A line-fed lexer cannot see the next line, so only a title after an
  ;; overline is a title. $prev: 0 after a blank line, 1 after text, 2 after an
  ;; opening overline. $block: 1 a comment, 2 a literal block, 3 `::` waiting for
  ;; one, 4 after a code directive; $indent: the indentation it must exceed.
  (func $hlRst
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $q i32)
    (local $prev i32)
    (local $block i32)
    (local $indent i32)
    (local $mid i32)
    (local $lineEnd i32)
    (local $lineIndent i32)
    (call $lexEmitLeadingContinuation)
    (local.set $mid (i32.const 0))
    (local.set $lineEnd (i32.const 0))
    (local.set $lineIndent (i32.const 0))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if (byteset.get "\n\r" (local.get $c))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (if
              (i32.and
                (i32.eq (local.get $c) (i32.const 13))
                (i32.eq (call $templateByte (global.get $ptr)) (i32.const 10)))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (if (i32.eqz (local.get $mid))
              (then (local.set $prev (i32.const 0))))
            (local.set $mid (i32.const 0))
            (br $next)))

        (if (i32.eqz (local.get $mid))
          (then
            (global.set $ptr (call $lexSkipSpaceAt (local.get $lhs)))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (local.set $lineIndent (i32.sub (global.get $ptr) (local.get $lhs)))
            (local.set $lhs (global.get $ptr))
            (local.set $lineEnd (call $lexFindEither (local.get $lhs) (i32.const 10) (i32.const 13)))
            ;; a blank line keeps $mid 0 for its line break
            (br_if $next (i32.ge_u (local.get $lhs) (local.get $lineEnd)))
            (local.set $mid (i32.const 1))
            (local.set $c (i32.load8_u (local.get $lhs)))
            (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
            (local.set $rhs (call $rstTrimEnd (local.get $lhs) (local.get $lineEnd)))
            (if (local.get $block)
              (then
                (if (i32.gt_u (local.get $lineIndent) (local.get $indent))
                  (then
                    (if
                      (i32.or
                        (i32.le_u (local.get $block) (i32.const 2))
                        (i32.or
                          (i32.eq (local.get $block) (i32.const 3))
                          (i32.ne (local.get $c) (i32.const ":"))))
                      (then
                        (local.set $block (select (i32.const 1) (i32.const 2) (i32.eq (local.get $block) (i32.const 1))))
                        (local.set $prev (i32.const 1))
                        (global.set $ptr (local.get $lineEnd))
                        (call $emitTok
                          (select
                            (enum.get $Token.comment)
                            (enum.get $Token.text.literal)
                            (i32.eq (local.get $block) (i32.const 1)))
                          (local.get $lhs)
                          (global.get $ptr))
                        (br $next))))
                  (else (local.set $block (i32.const 0))))))

            (local.set $q (call $rstIsRule (local.get $lhs) (local.get $rhs)))
            (if (local.get $q)
              (then
                (local.set $prev
                  (select
                    (i32.const 2)
                    (i32.const 1)
                    (i32.and (i32.eq (local.get $q) (i32.const 1)) (i32.ne (local.get $prev) (i32.const 1)))))
                (global.set $ptr (local.get $rhs))
                (call $emitTok
                  (select (enum.get $Token.title) (enum.get $Token.punctuation.markup) (i32.eq (local.get $q) (i32.const 1)))
                  (local.get $lhs)
                  (global.get $ptr))
                (br $next)))
            (if (i32.eq (local.get $prev) (i32.const 2))
              (then
                (local.set $prev (i32.const 1))
                (global.set $ptr (local.get $rhs))
                (call $emitTok (enum.get $Token.title) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (local.set $prev (i32.const 1))

            (if
              (i32.and
                (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c2) (i32.const ".")))
                (i32.or
                  (i32.ge_u (i32.add (local.get $lhs) (i32.const 2)) (local.get $lineEnd))
                  (call $lexIsSpace (i32.load8_u offset=2 (local.get $lhs)))))
              (then
                (local.set $p (call $lexSkipSpaceAt (i32.add (local.get $lhs) (i32.const 2))))
                (local.set $c2 (call $templateByte (local.get $p)))
                (local.set $rhs (i32.const 0))
                (local.set $q (i32.const 0))
                (if (i32.eq (local.get $c2) (i32.const "_"))
                  (then
                    (local.set $q (local.get $p))
                    (block $found
                      (loop $colon
                        (local.set $q
                          (call $scanFindSpecial
                            (i32.add (local.get $q) (i32.const 1))
                            (local.get $lineEnd)
                            (i32.const ":")
                            (i32.const 0)
                            (i32.const 0)))
                        (br_if $found (i32.ge_u (local.get $q) (local.get $lineEnd)))
                        (br_if $colon
                          (i32.and
                            (i32.lt_u (i32.add (local.get $q) (i32.const 1)) (local.get $lineEnd))
                            (i32.eqz (call $lexIsSpace (i32.load8_u offset=1 (local.get $q))))))))
                    (if (i32.lt_u (local.get $q) (local.get $lineEnd))
                      (then
                        (local.set $q (i32.add (local.get $q) (i32.const 1)))
                        (local.set $rhs (enum.get $Token.link_text)))
                      (else (local.set $q (i32.const 0))))))
                (if (i32.eq (local.get $c2) (i32.const "["))
                  (then
                    (local.set $q
                      (call $scanFindSpecial (local.get $p) (local.get $lineEnd) (i32.const "]") (i32.const 0) (i32.const 0)))
                    (local.set $q
                      (select (i32.add (local.get $q) (i32.const 1)) (i32.const 0) (i32.lt_u (local.get $q) (local.get $lineEnd))))
                    (local.set $rhs (enum.get $Token.label))))
                (if (i32.eq (local.get $c2) (i32.const "|"))
                  (then
                    (local.set $q
                      (call $rstCloseEnd
                        (i32.add (local.get $p) (i32.const 2))
                        (local.get $lineEnd)
                        (i32.const "|")
                        (i32.const 1)
                        (i32.const 1)))
                    (local.set $rhs (enum.get $Token.variable.special))))
                (global.set $ptr (local.get $p))
                (if (local.get $q)
                  (then
                    (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (i32.add (local.get $lhs) (i32.const 2)))
                    (call $emitGap (i32.add (local.get $lhs) (i32.const 2)) (local.get $p))
                    (global.set $ptr (local.get $q))
                    (call $emitTok (local.get $rhs) (local.get $p) (global.get $ptr))
                    (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                    (call $emitGap (global.get $ptr) (local.get $p))
                    (global.set $ptr (local.get $p))
                    (if (i32.eq (local.get $rhs) (enum.get $Token.link_text))
                      (then
                        (global.set $ptr (call $rstTrimEnd (local.get $p) (local.get $lineEnd)))
                        (call $emitTok (enum.get $Token.link_uri) (local.get $p) (global.get $ptr))
                        (br $next)))
                    (local.set $c2 (call $templateByte (local.get $p))))
                  (else (local.set $rhs (i32.const 0))))
                (local.set $q (i32.const 0))
                (if (i32.and (call $lexIsIdentStart (local.get $c2)) (i32.ne (local.get $c2) (i32.const "$")))
                  (then
                    (block $name
                      (loop $part
                        (call $scanIdentRun (i32.const "-"))
                        (br_if $name (i32.ne (call $templateByte (global.get $ptr)) (i32.const ":")))
                        (local.set $c2 (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
                        (if (i32.eq (local.get $c2) (i32.const ":"))
                          (then
                            (local.set $q (global.get $ptr))
                            (br $name)))
                        (br_if $name (i32.eqz (call $rstIsAlnum (local.get $c2))))
                        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                        (br $part)))))
                (if (local.get $q)
                  (then
                    (if (i32.eqz (local.get $rhs))
                      (then
                        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (i32.add (local.get $lhs) (i32.const 2)))
                        (call $emitGap (i32.add (local.get $lhs) (i32.const 2)) (local.get $p))))
                    (call $emitTok (enum.get $Token.keyword) (local.get $p) (local.get $q))
                    (global.set $ptr (i32.add (local.get $q) (i32.const 2)))
                    (call $emitTok (enum.get $Token.punctuation.special) (local.get $q) (global.get $ptr))
                    (local.set $c (i32.sub (local.get $q) (local.get $p)))
                    (local.set $c2 (i32.load (local.get $p)))
                    (if
                      (i32.or
                        (i32.or
                          (i32.and (i32.ge_u (local.get $c) (i32.const 4)) (i32.eq (local.get $c2) (i32.const "code")))
                          (i32.and
                            (i32.eq (local.get $c) (i32.const 10))
                            (i64.eq (i64.load (local.get $p)) (i64.const "sourceco"))))
                        (i32.or
                          (i32.and (i32.eq (local.get $c) (i32.const 4)) (i32.eq (local.get $c2) (i32.const "math")))
                          (i32.and
                            (i32.eq (local.get $c) (i32.const 3))
                            (i32.eq (i32.and (local.get $c2) (i32.const 0xffffff)) (i32.const "raw")))))
                      (then
                        (local.set $block (i32.const 4))
                        (local.set $indent (local.get $lineIndent))))
                    (br $next)))
                (global.set $ptr (local.get $p))
                (br_if $next (local.get $rhs))
                (local.set $block (i32.const 1))
                (local.set $indent (local.get $lineIndent))
                (global.set $ptr (local.get $lineEnd))
                (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
                (br $next)))

            (if (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.eqz (call $lexIsSpace (local.get $c2))))
              (then
                (local.set $q
                  (call $scanFindSpecial
                    (i32.add (local.get $lhs) (i32.const 2))
                    (local.get $lineEnd)
                    (i32.const ":")
                    (i32.const 0)
                    (i32.const 0)))
                (if
                  (i32.and
                    (i32.lt_u (local.get $q) (local.get $lineEnd))
                    (i32.or
                      (i32.ge_u (i32.add (local.get $q) (i32.const 1)) (local.get $lineEnd))
                      (call $lexIsSpace (i32.load8_u offset=1 (local.get $q)))))
                  (then
                    (global.set $ptr (i32.add (local.get $q) (i32.const 1)))
                    (call $emitTok (enum.get $Token.property) (local.get $lhs) (global.get $ptr))
                    (br $next)))))

            (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
            (if (i32.eqz (byteset.get "*+-|" (local.get $c)))
              (then
                (local.set $p (i32.add (local.get $lhs) (i32.eq (local.get $c) (i32.const "("))))
                (local.set $q (local.get $p))
                (block $enumDone
                  (loop $digits
                    (br_if $enumDone (i32.ge_u (local.get $p) (local.get $lineEnd)))
                    (br_if $enumDone (i32.eqz (call $lexIsDigit (i32.load8_u (local.get $p)))))
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br $digits)))
                (if
                  (i32.and
                    (i32.eq (local.get $p) (local.get $q))
                    (i32.or
                      (i32.eq (call $templateByte (local.get $p)) (i32.const "#"))
                      (call $rstIsAlnum (call $templateByte (local.get $p)))))
                  (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
                (local.set $c2 (call $templateByte (local.get $p)))
                (local.set $p
                  (select
                    (i32.add (local.get $p) (i32.const 1))
                    (local.get $lhs)
                    (i32.and
                      (i32.gt_u (local.get $p) (local.get $q))
                      (i32.or
                        (i32.eq (local.get $c2) (i32.const ")"))
                        (i32.and (i32.eq (local.get $c2) (i32.const ".")) (i32.ne (local.get $c) (i32.const "(")))))))))
            (if
              (i32.and
                (i32.gt_u (local.get $p) (local.get $lhs))
                (i32.or
                  (i32.ge_u (local.get $p) (local.get $lineEnd))
                  (call $lexIsSpace (i32.load8_u (local.get $p)))))
              (then
                (global.set $ptr (local.get $p))
                (call $emitTok
                  (select
                    (enum.get $Token.punctuation.markup)
                    (enum.get $Token.punctuation.list_marker)
                    (i32.eq (local.get $c) (i32.const "|")))
                  (local.get $lhs)
                  (global.get $ptr))
                (br $next)))
            (if
              (i32.and
                (i32.eq (local.get $c) (i32.const "+"))
                (i32.or (i32.eq (local.get $c2) (i32.const "-")) (i32.eq (local.get $c2) (i32.const "="))))
              (then
                (global.set $ptr (local.get $rhs))
                (call $emitTok (enum.get $Token.punctuation.markup) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (if
              (i32.and
                (i32.eq (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff)) (i32.const ">>>"))
                (i32.ge_u (local.get $lineEnd) (i32.add (local.get $lhs) (i32.const 3))))
              (then
                (global.set $ptr (local.get $lineEnd))
                (call $emitTok (enum.get $Token.text.literal) (local.get $lhs) (global.get $ptr))
                (br $next)))))

        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (if (call $lexIsSpace (local.get $c))
          (then
            (global.set $ptr (call $lexSkipSpaceAt (local.get $lhs)))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if
          (i32.and
            (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $c2) (i32.const ":")))
            (i32.ge_u (call $lexSkipSpaceAt (i32.add (local.get $lhs) (i32.const 2))) (local.get $lineEnd)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (if (i32.eqz (local.get $block))
              (then
                (local.set $block (i32.const 3))
                (local.set $indent (local.get $lineIndent))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const 92)) (i32.lt_u (i32.add (local.get $lhs) (i32.const 1)) (local.get $lineEnd)))
          (then
            (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 2)) (local.get $lineEnd)))
            (call $emitTok (enum.get $Token.string.escape) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; an inline markup start follows a blank or punctuation and comes before a
        ;; non-blank byte
        (if
          (i32.eqz
            (i32.or
              (call $lexIsSpace (local.get $c2))
              (i32.and
                (i32.gt_u (local.get $lhs) (global.get $srcBase))
                (call $rstIsAlnum (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1)))))))
          (then
            (if (i32.eq (local.get $c) (i32.const "`"))
              (then
                (if (i32.eq (local.get $c2) (i32.const "`"))
                  (then
                    (global.set $ptr
                      (call $rstCloseEnd (i32.add (local.get $lhs) (i32.const 3)) (local.get $lineEnd) (i32.const "`") (i32.const 2) (i32.const 1)))
                    (if (global.get $ptr)
                      (then (call $emitTok (enum.get $Token.text.literal) (local.get $lhs) (global.get $ptr)))
                      (else
                        ;; an unclosed run stays text as a whole
                        (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))))
                    (br $next)))
                (local.set $q
                  (call $rstCloseEnd (i32.add (local.get $lhs) (i32.const 2)) (local.get $lineEnd) (i32.const "`") (i32.const 1) (i32.const 1)))
                (if (local.get $q)
                  (then
                    (local.set $rhs (call $rstLinkSuffix (local.get $q) (local.get $lineEnd)))
                    (global.set $ptr (local.get $q))
                    (if (i32.eqz (local.get $rhs))
                      (then
                        (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                        (br $next)))
                    (local.set $p (local.get $lhs))
                    (if (i32.eq (i32.load8_u (i32.sub (local.get $q) (i32.const 2))) (i32.const ">"))
                      (then
                        (local.set $p
                          (call $scanFindSpecial (local.get $lhs) (local.get $q) (i32.const "<") (i32.const 0) (i32.const 0)))
                        (if (i32.lt_u (local.get $p) (i32.sub (local.get $q) (i32.const 2)))
                          (then
                            (call $emitTok (enum.get $Token.link_text) (local.get $lhs) (local.get $p))
                            (call $emitTok (enum.get $Token.link_uri) (local.get $p) (i32.sub (local.get $q) (i32.const 1)))
                            (local.set $p (i32.sub (local.get $q) (i32.const 1))))
                          (else (local.set $p (local.get $lhs))))))
                    (global.set $ptr (i32.add (local.get $q) (local.get $rhs)))
                    (call $emitTok (enum.get $Token.link_text) (local.get $p) (global.get $ptr))
                    (br $next)))))
            (if (i32.eq (local.get $c) (i32.const "*"))
              (then
                (local.set $q (i32.add (i32.const 1) (i32.eq (local.get $c2) (i32.const "*"))))
                (global.set $ptr (i32.add (local.get $lhs) (local.get $q)))
                (if (i32.eqz (call $lexIsSpace (call $templateByte (global.get $ptr))))
                  (then
                    (local.set $p
                      (call $rstCloseEnd
                        (i32.add (global.get $ptr) (i32.const 1))
                        (local.get $lineEnd)
                        (i32.const "*")
                        (local.get $q)
                        (i32.const 1)))
                    (if (local.get $p)
                      (then
                        (global.set $ptr (local.get $p))
                        (call $emitTok
                          (select
                            (enum.get $Token.emphasis.strong)
                            (enum.get $Token.emphasis)
                            (i32.eq (local.get $q) (i32.const 2)))
                          (local.get $lhs)
                          (global.get $ptr))
                        (br $next)))))
                (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const "|"))
              (then
                (local.set $p
                  (call $rstCloseEnd (i32.add (local.get $lhs) (i32.const 2)) (local.get $lineEnd) (i32.const "|") (i32.const 1) (i32.const 1)))
                (if (local.get $p)
                  (then
                    (global.set $ptr (i32.add (local.get $p) (call $rstLinkSuffix (local.get $p) (local.get $lineEnd))))
                    (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
                    (br $next)))))
            (if (i32.eq (local.get $c) (i32.const "["))
              (then
                (local.set $p
                  (call $scanFindSpecial (local.get $lhs) (local.get $lineEnd) (i32.const "]") (i32.const 0) (i32.const 0)))
                (if
                  (i32.and
                    (i32.and
                      (i32.lt_u (local.get $p) (local.get $lineEnd))
                      (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const "_")))
                    (i32.eq
                      (call $scanFindSpecial (local.get $lhs) (local.get $p) (i32.const 32) (i32.const 0) (i32.const 0))
                      (local.get $p)))
                  (then
                    (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
                    (call $emitTok (enum.get $Token.link_text) (local.get $lhs) (global.get $ptr))
                    (br $next)))))))
        (if (i32.and (i32.eq (local.get $c) (i32.const ":")) (call $rstIsAlnum (local.get $c2)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (block $role
              (loop $part
                (call $scanIdentRun (i32.const "-"))
                (br_if $role (i32.ne (call $templateByte (global.get $ptr)) (i32.const ":")))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (local.set $c2 (call $templateByte (global.get $ptr)))
                (if (i32.eq (local.get $c2) (i32.const "`"))
                  (then
                    (call $emitTok (enum.get $Token.function) (local.get $lhs) (global.get $ptr))
                    (br $next)))
                (br_if $part (call $rstIsAlnum (local.get $c2)))))))
        (local.set $q (call $rstPlainEnd (i32.add (local.get $lhs) (i32.const 1)) (local.get $lineEnd) (i32.const "[") (i32.const "[") (i32.const "[")))
        (local.set $c (call $templateByte (local.get $q)))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const ":"))
            (i32.eq (i32.load16_u offset=1 (local.get $q)) (i32.const 0x2f2f)))
          (then
            (local.set $p (call $rstWordStart (local.get $lhs) (local.get $q)))
            (if (i32.lt_u (local.get $p) (local.get $q))
              (then
                (call $emitTok (enum.get $Token.none) (local.get $lhs) (local.get $p))
                (global.set $ptr
                  (call $scanFindSpecial (local.get $q) (local.get $lineEnd) (i32.const 32) (i32.const 0) (i32.const 0)))
                (call $emitTok (enum.get $Token.link_uri) (local.get $p) (global.get $ptr))
                (br $next)))))
        (if (i32.eq (local.get $c) (i32.const "_"))
          (then
            (local.set $p (call $rstWordStart (local.get $lhs) (local.get $q)))
            (global.set $ptr (local.get $q))
            (call $scanIdentRun (i32.const "-"))
            (local.set $q (global.get $ptr))
            (local.set $rhs (i32.sub (local.get $q) (i32.const 1)))
            (if (i32.eq (i32.load8_u (local.get $rhs)) (i32.const "_"))
              (then
                (local.set $rhs
                  (i32.sub (local.get $rhs) (i32.eq (i32.load8_u (i32.sub (local.get $rhs) (i32.const 1))) (i32.const "_"))))
                (if
                  (i32.and
                    (i32.gt_u (local.get $rhs) (local.get $p))
                    (i32.and
                      (call $rstIsAlnum (i32.load8_u (local.get $p)))
                      (call $rstIsAlnum (i32.load8_u (i32.sub (local.get $rhs) (i32.const 1))))))
                  (then
                    (call $emitTok (enum.get $Token.none) (local.get $lhs) (local.get $p))
                    (call $emitTok (enum.get $Token.link_text) (local.get $p) (local.get $q))
                    (br $next)))))))
        (global.set $ptr (local.get $q))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
