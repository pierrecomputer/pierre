(module
  (import "../common.wat")
  (import "./rst.wat")

  (func $adocIsAdmonition (param $p i32) (param $stop i32) (result i32)
    (local $n i32)
    (local $w i64)
    (local.set $n (i32.sub (local.get $stop) (local.get $p)))
    (local.set $w (i64.load (local.get $p)))
    (i32.or
      (i32.or
        (i32.and
          (i32.eq (local.get $n) (i32.const 3))
          (i32.eq (i32.and (i32.wrap_i64 (local.get $w)) (i32.const 0xffffff)) (i32.const "TIP")))
        (i32.and (i32.eq (local.get $n) (i32.const 4)) (i32.eq (i32.wrap_i64 (local.get $w)) (i32.const "NOTE"))))
      (i32.or
        (i32.and
          (i32.eq (local.get $n) (i32.const 7))
          (i32.or
            (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffffff)) (i64.const "WARNING"))
            (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffffff)) (i64.const "CAUTION"))))
        (i32.and
          (i32.eq (local.get $n) (i32.const 9))
          (i64.eq (local.get $w) (i64.const "IMPORTAN"))))))

  ;; $delim: the byte and, from bit 8, the length of the delimiter line that
  ;; closes an open block. $para: 0 after a blank line, 1 in a paragraph, 2 in a
  ;; literal (indented) paragraph.
  (func $hlAsciidoc
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $q i32)
    (local $n i32)
    (local $delim i32)
    (local $para i32)
    (local $mid i32)
    (local $lineEnd i32)
    (call $lexEmitLeadingContinuation)
    (local.set $mid (i32.const 0))
    (local.set $lineEnd (i32.const 0))
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
              (then (local.set $para (i32.const 0))))
            (local.set $mid (i32.const 0))
            (br $next)))

        (if (i32.eqz (local.get $mid))
          (then
            (global.set $ptr (call $lexSkipSpaceAt (local.get $lhs)))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (local.set $p (global.get $ptr))
            (local.set $lineEnd (call $lexFindEither (local.get $p) (i32.const 10) (i32.const 13)))
            ;; a blank line keeps $mid 0 for its line break
            (br_if $next (i32.ge_u (local.get $p) (local.get $lineEnd)))
            (local.set $mid (i32.const 1))
            (local.set $c (i32.load8_u (local.get $p)))
            (local.set $c2 (call $templateByte (i32.add (local.get $p) (i32.const 1))))
            (local.set $rhs (call $rstTrimEnd (local.get $p) (local.get $lineEnd)))
            (local.set $n (i32.sub (local.get $rhs) (local.get $p)))
            (local.set $q (call $rstIsRule (local.get $p) (local.get $rhs)))

            (if (local.get $delim)
              (then
                (if
                  (i32.and
                    (i32.and (i32.eq (local.get $p) (local.get $lhs)) (i32.eq (local.get $q) (i32.const 1)))
                    (i32.eq
                      (local.get $delim)
                      (i32.or (local.get $c) (i32.shl (local.get $n) (i32.const 8)))))
                  (then
                    (local.set $delim (i32.const 0))
                    (global.set $ptr (local.get $rhs))
                    (call $emitTok (enum.get $Token.punctuation.markup) (local.get $p) (global.get $ptr)))
                  (else
                    (global.set $ptr (local.get $lineEnd))
                    (call $emitTok
                      (select
                        (enum.get $Token.comment)
                        (enum.get $Token.text.literal)
                        (i32.eq (i32.and (local.get $delim) (i32.const 255)) (i32.const "/")))
                      (local.get $p)
                      (global.get $ptr))))
                (br $next)))
            (if (i32.eqz (local.get $para))
              (then (local.set $para (i32.add (i32.const 1) (i32.gt_u (local.get $p) (local.get $lhs))))))
            (if (i32.eq (local.get $para) (i32.const 2))
              (then
                (global.set $ptr (local.get $lineEnd))
                (call $emitTok (enum.get $Token.text.literal) (local.get $p) (global.get $ptr))
                (br $next)))

            (if
              (i32.or
                (i32.eq (local.get $q) (i32.const 1))
                (i32.or
                  (i32.and (i32.eq (local.get $n) (i32.const 2)) (i32.eq (i32.load16_u (local.get $p)) (i32.const 0x2d2d)))
                  (i32.or
                    (i32.and (i32.eq (local.get $n) (i32.const 1)) (i32.eq (local.get $c) (i32.const "+")))
                    (i32.and (i32.ge_u (local.get $n) (i32.const 4)) (i32.eq (i32.load (local.get $p)) (i32.const "|==="))))))
              (then
                (if
                  (i32.and
                    (i32.eq (local.get $q) (i32.const 1))
                    (i32.or
                      (i32.and
                        (i32.ge_u (local.get $n) (i32.const 4))
                        (i32.or
                          (i32.or (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c) (i32.const ".")))
                          (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "/")))))
                      (i32.eq (local.get $c) (i32.const "`"))))
                  (then (local.set $delim (i32.or (local.get $c) (i32.shl (local.get $n) (i32.const 8))))))
                (global.set $ptr (local.get $rhs))
                (call $emitTok (enum.get $Token.punctuation.markup) (local.get $p) (global.get $ptr))
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const "="))
              (then
                (local.set $q (local.get $p))
                (block $levels
                  (loop $level
                    (local.set $q (i32.add (local.get $q) (i32.const 1)))
                    (br_if $levels (i32.ge_u (local.get $q) (local.get $lineEnd)))
                    (br_if $level (i32.eq (i32.load8_u (local.get $q)) (i32.const "=")))))
                (if
                  (i32.and
                    (i32.le_u (i32.sub (local.get $q) (local.get $p)) (i32.const 6))
                    (i32.and (i32.lt_u (local.get $q) (local.get $lineEnd)) (call $lexIsSpace (i32.load8_u (local.get $q)))))
                  (then
                    (global.set $ptr (local.get $rhs))
                    (call $emitTok (enum.get $Token.title) (local.get $p) (global.get $ptr))
                    (br $next)))))
            (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
              (then
                (global.set $ptr (local.get $lineEnd))
                (call $emitTok (enum.get $Token.comment) (local.get $p) (global.get $ptr))
                (br $next)))
            (if (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.eqz (call $lexIsSpace (local.get $c2))))
              (then
                (local.set $q
                  (call $scanFindSpecial (i32.add (local.get $p) (i32.const 2)) (local.get $lineEnd) (i32.const ":") (i32.const 0) (i32.const 0)))
                (if
                  (i32.and
                    (i32.lt_u (local.get $q) (local.get $lineEnd))
                    (i32.and
                      (i32.eq
                        (call $scanFindSpecial (local.get $p) (local.get $q) (i32.const 32) (i32.const 0) (i32.const 0))
                        (local.get $q))
                      (i32.or
                        (i32.ge_u (i32.add (local.get $q) (i32.const 1)) (local.get $lineEnd))
                        (call $lexIsSpace (i32.load8_u offset=1 (local.get $q))))))
                  (then
                    (global.set $ptr (i32.add (local.get $q) (i32.const 1)))
                    (call $emitTok (enum.get $Token.property) (local.get $p) (global.get $ptr))
                    (br $next)))))
            (if
              (i32.and
                (i32.eq (local.get $c) (i32.const "["))
                (i32.eq (i32.load8_u (i32.sub (local.get $rhs) (i32.const 1))) (i32.const "]")))
              (then
                (local.set $q (i32.sub (local.get $rhs) (i32.const 1)))
                (global.set $ptr (local.get $rhs))
                (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $p) (i32.add (local.get $p) (i32.const 1)))
                (call $emitTok (enum.get $Token.attribute) (i32.add (local.get $p) (i32.const 1)) (local.get $q))
                (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $q) (local.get $rhs))
                (br $next)))
            (if
              (i32.and
                (i32.eq (local.get $c) (i32.const "."))
                (i32.eqz (i32.or (call $lexIsSpace (local.get $c2)) (i32.eq (local.get $c2) (i32.const ".")))))
              (then
                (global.set $ptr (local.get $rhs))
                (call $emitTok (enum.get $Token.label) (local.get $p) (global.get $ptr))
                (br $next)))
            (local.set $q (local.get $p))
            (if (byteset.get "*-." (local.get $c))
              (then
                (block $runDone
                  (loop $run
                    (local.set $q (i32.add (local.get $q) (i32.const 1)))
                    (br_if $runDone (i32.ge_u (local.get $q) (local.get $lineEnd)))
                    (br_if $run (i32.eq (i32.load8_u (local.get $q)) (local.get $c)))))))
            (if (call $rstIsAlnum (local.get $c))
              (then
                (local.set $q (local.get $p))
                (block $digitsDone
                  (loop $digits
                    (local.set $q (i32.add (local.get $q) (i32.const 1)))
                    (br_if $digitsDone (i32.ge_u (local.get $q) (local.get $lineEnd)))
                    (br_if $digits (call $lexIsDigit (i32.load8_u (local.get $q))))))
                (local.set $q
                  (select
                    (i32.add (local.get $q) (i32.const 1))
                    (local.get $p)
                    (i32.and
                      (i32.eq (call $templateByte (local.get $q)) (i32.const "."))
                      (i32.or
                        (call $lexIsDigit (local.get $c))
                        (i32.eq (local.get $q) (i32.add (local.get $p) (i32.const 1)))))))))
            (if (i32.and (i32.eq (local.get $c) (i32.const "<")) (call $lexIsDigit (local.get $c2)))
              (then
                (local.set $q (call $scanFindSpecial (local.get $p) (local.get $lineEnd) (i32.const ">") (i32.const 0) (i32.const 0)))
                (local.set $q (select (i32.add (local.get $q) (i32.const 1)) (local.get $p) (i32.lt_u (local.get $q) (local.get $lineEnd))))))
            (if
              (i32.and
                (i32.gt_u (local.get $q) (local.get $p))
                (i32.and (i32.lt_u (local.get $q) (local.get $lineEnd)) (call $lexIsSpace (i32.load8_u (local.get $q)))))
              (then
                (global.set $ptr (local.get $q))
                (call $emitTok (enum.get $Token.punctuation.list_marker) (local.get $p) (global.get $ptr))
                (br $next)))
            (global.set $ptr (local.get $p))
            (call $scanIdentRun (i32.const "-"))
            (if
              (i32.and
                (i32.eq (call $templateByte (global.get $ptr)) (i32.const ":"))
                (call $adocIsAdmonition (local.get $p) (global.get $ptr)))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.keyword) (local.get $p) (global.get $ptr))
                (br $next)))
            (global.set $ptr (local.get $p))
            (local.set $q (local.get $p))
            (block $termDone
              (loop $term
                (local.set $q
                  (call $scanFindSpecial (local.get $q) (local.get $lineEnd) (i32.const ":") (i32.const 0) (i32.const 0)))
                (br_if $termDone (i32.ge_u (local.get $q) (local.get $lineEnd)))
                (local.set $n (local.get $q))
                (block $colonsDone
                  (loop $colons
                    (local.set $n (i32.add (local.get $n) (i32.const 1)))
                    (br_if $colonsDone (i32.ge_u (local.get $n) (local.get $lineEnd)))
                    (br_if $colons (i32.eq (i32.load8_u (local.get $n)) (i32.const ":")))))
                (if
                  (i32.and
                    (i32.and (i32.gt_u (local.get $q) (local.get $p)) (i32.ge_u (i32.sub (local.get $n) (local.get $q)) (i32.const 2)))
                    (i32.or (i32.ge_u (local.get $n) (local.get $lineEnd)) (call $lexIsSpace (i32.load8_u (local.get $n)))))
                  (then
                    (call $emitTok (enum.get $Token.property) (local.get $p) (local.get $q))
                    (global.set $ptr (local.get $n))
                    (call $emitTok (enum.get $Token.punctuation.special) (local.get $q) (global.get $ptr))
                    (br $next)))
                (local.set $q (local.get $n))
                (br $term)))
            (local.set $lhs (local.get $p))))

        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (if (call $lexIsSpace (local.get $c))
          (then
            (global.set $ptr (call $lexSkipSpaceAt (local.get $lhs)))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const 92))
            (i32.and
              (i32.lt_u (i32.add (local.get $lhs) (i32.const 1)) (local.get $lineEnd))
              (i32.and
                (i32.le_u (i32.sub (local.get $c2) (i32.const 33)) (i32.const 93))
                (i32.eqz (call $rstIsAlnum (local.get $c2))))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
            (call $emitTok (enum.get $Token.string.escape) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; doubled markers pair anywhere; single ones only after a blank or punctuation
        ;; and before a letter or digit
        (if (byteset.get "#*_`" (local.get $c))
          (then
            (local.set $n (i32.add (i32.const 1) (i32.eq (local.get $c2) (local.get $c))))
            (global.set $ptr (i32.add (local.get $lhs) (local.get $n)))
            (if
              (i32.eqz
                (i32.or
                  (call $lexIsSpace (call $templateByte (global.get $ptr)))
                  (i32.and
                    (i32.eq (local.get $n) (i32.const 1))
                    (i32.and
                      (i32.gt_u (local.get $lhs) (global.get $srcBase))
                      (call $rstIsAlnum (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))))))))
              (then
                (local.set $q
                  (call $rstCloseEnd
                    (i32.add (global.get $ptr) (i32.const 1))
                    (local.get $lineEnd)
                    (local.get $c)
                    (local.get $n)
                    (i32.eq (local.get $n) (i32.const 1))))
                (if (local.get $q)
                  (then
                    (global.set $ptr (local.get $q))
                    (call $emitTok
                      (select
                        (enum.get $Token.emphasis.strong)
                        (select
                          (enum.get $Token.emphasis)
                          (select
                            (enum.get $Token.text.literal)
                            (enum.get $Token.string.special)
                            (i32.eq (local.get $c) (i32.const "`")))
                          (i32.eq (local.get $c) (i32.const "_")))
                        (i32.eq (local.get $c) (i32.const "*")))
                      (local.get $lhs)
                      (global.get $ptr))
                    (br $next)))))
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "{")) (call $lexIsIdentContinue (local.get $c2)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const "-"))
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "}"))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c2) (i32.const "<")))
          (then
            (local.set $q
              (call $rstCloseEnd (i32.add (local.get $lhs) (i32.const 3)) (local.get $lineEnd) (i32.const ">") (i32.const 2) (i32.const 0)))
            (global.set $ptr (select (local.get $q) (i32.add (local.get $lhs) (i32.const 2)) (local.get $q)))
            (call $emitTok
              (select (enum.get $Token.link_text) (enum.get $Token.none) (local.get $q))
              (local.get $lhs)
              (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "|"))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.markup) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (local.set $q (call $rstPlainEnd (i32.add (local.get $lhs) (i32.const 1)) (local.get $lineEnd) (i32.const "#") (i32.const "{") (i32.const "<")))
        (if (i32.eq (call $templateByte (local.get $q)) (i32.const ":"))
          (then
            (local.set $rhs (local.get $q))
            (local.set $c (call $rstWordStart (local.get $lhs) (local.get $rhs)))
            (local.set $p (i32.add (local.get $rhs) (i32.const 1)))
            (local.set $n (i32.const 0))
            (if (i32.lt_u (local.get $c) (local.get $rhs))
              (then
                (if (i32.eq (i32.load16_u (local.get $p)) (i32.const 0x2f2f))
                  (then
                    (local.set $q
                      (call $scanFindSpecial (local.get $p) (local.get $lineEnd) (i32.const 32) (i32.const 0) (i32.const 0)))
                    (call $emitTok (enum.get $Token.none) (local.get $lhs) (local.get $c))
                    (global.set $ptr
                      (call $scanFindSpecial (local.get $p) (local.get $q) (i32.const "[") (i32.const 0) (i32.const 0)))
                    (call $emitTok (enum.get $Token.link_uri) (local.get $c) (global.get $ptr))
                    (local.set $n (i32.const 1)))
                  (else
                    (local.set $p
                      (i32.add (local.get $p) (i32.eq (call $templateByte (local.get $p)) (i32.const ":"))))
                    (local.set $q
                      (call $scanFindSpecial (local.get $p) (local.get $lineEnd) (i32.const "[") (i32.const 0) (i32.const 0)))
                    (if
                      (i32.and
                        (i32.lt_u (local.get $q) (local.get $lineEnd))
                        (i32.eq
                          (call $scanFindSpecial (local.get $p) (local.get $q) (i32.const 32) (i32.const 0) (i32.const 0))
                          (local.get $q)))
                      (then
                        (call $emitTok (enum.get $Token.none) (local.get $lhs) (local.get $c))
                        (call $emitTok (enum.get $Token.function) (local.get $c) (local.get $p))
                        (global.set $ptr (local.get $q))
                        (call $emitTok (enum.get $Token.link_uri) (local.get $p) (global.get $ptr))
                        (local.set $n (i32.const 1))))))))
            (if (local.get $n)
              (then
                (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "["))
                  (then
                    (local.set $q
                      (call $scanFindSpecial (global.get $ptr) (local.get $lineEnd) (i32.const "]") (i32.const 0) (i32.const 0)))
                    (if (i32.lt_u (local.get $q) (local.get $lineEnd))
                      (then
                        (local.set $p (global.get $ptr))
                        (global.set $ptr (i32.add (local.get $q) (i32.const 1)))
                        (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $p) (i32.add (local.get $p) (i32.const 1)))
                        (call $emitTok (enum.get $Token.string) (i32.add (local.get $p) (i32.const 1)) (local.get $q))
                        (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $q) (global.get $ptr))))))
                (br $next)))
            (local.set $q (local.get $rhs))))
        (global.set $ptr (local.get $q))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
