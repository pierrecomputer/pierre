(module
  (import "../common.wat")

  (func $hlDiff
    (local $c i32)
    (local $lhs i32)
    (local $lineEnd i32)
    (local $p i32)
    (local $tok i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $line
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (call $scanToLineEnd)
        (local.set $lineEnd (global.get $ptr))

        (block $emitDone
          ;; `diff` is a function, its first argument a parameter, and paths plain.
          (if (i32.and
                (i32.ge_u (i32.sub (local.get $lineEnd) (local.get $lhs)) (i32.const 4))
                (i32.and
                  (i32.eq (i32.load (local.get $lhs)) (i32.const "diff"))
                  (i32.or
                    (i32.eq (i32.add (local.get $lhs) (i32.const 4)) (local.get $lineEnd))
                    (call $lexIsSpace (i32.load8_u offset=4 (local.get $lhs))))))
            (then
              (call $emitTok (enum.get $Token.function)
                (local.get $lhs) (i32.add (local.get $lhs) (i32.const 4)))
              (local.set $p (i32.add (local.get $lhs) (i32.const 4)))
              (local.set $tok (local.get $p))
              (block $spaceDone
                (loop $space
                  (br_if $spaceDone (i32.ge_u (local.get $p) (local.get $lineEnd)))
                  (br_if $spaceDone (i32.eqz (call $lexIsSpace (i32.load8_u (local.get $p)))))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br $space)))
              (call $emitGap (local.get $tok) (local.get $p))
              (local.set $tok (local.get $p))
              (block $argDone
                (loop $arg
                  (br_if $argDone (i32.ge_u (local.get $p) (local.get $lineEnd)))
                  (br_if $argDone (call $lexIsSpace (i32.load8_u (local.get $p))))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br $arg)))
              (call $emitTok (enum.get $Token.variable.parameter) (local.get $tok) (local.get $p))
              (call $emitTok (enum.get $Token.none) (local.get $p) (local.get $lineEnd))
              (br $emitDone)))

          ;; Split an index line into its keyword, commits, separator, and mode.
          (if (i32.and
                (i32.ge_u (i32.sub (local.get $lineEnd) (local.get $lhs)) (i32.const 5))
                (i32.and
                  (i64.eq
                    (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffff))
                    (i64.const "index"))
                  (i32.or
                    (i32.eq (i32.add (local.get $lhs) (i32.const 5)) (local.get $lineEnd))
                    (call $lexIsSpace (i32.load8_u offset=5 (local.get $lhs))))))
            (then
              (call $emitTok (enum.get $Token.keyword)
                (local.get $lhs) (i32.add (local.get $lhs) (i32.const 5)))
              (local.set $p (i32.add (local.get $lhs) (i32.const 5)))
              (local.set $tok (local.get $p))
              (block $spaceDone
                (loop $space
                  (br_if $spaceDone (i32.ge_u (local.get $p) (local.get $lineEnd)))
                  (br_if $spaceDone (i32.eqz (call $lexIsSpace (i32.load8_u (local.get $p)))))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br $space)))
              (call $emitGap (local.get $tok) (local.get $p))

              (local.set $tok (local.get $p))
              (block $commitDone
                (loop $commit
                  (br_if $commitDone (i32.ge_u (local.get $p) (local.get $lineEnd)))
                  (br_if $commitDone (i32.eqz (call $lexIsHex (i32.load8_u (local.get $p)))))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br $commit)))
              (if (i32.eq (local.get $p) (local.get $tok))
                (then
                  (call $emitTok (enum.get $Token.none) (local.get $p) (local.get $lineEnd))
                  (br $emitDone)))
              (call $emitTok (enum.get $Token.constant) (local.get $tok) (local.get $p))
              (if (i32.or
                    (i32.gt_u (i32.add (local.get $p) (i32.const 2)) (local.get $lineEnd))
                    (i32.ne (i32.load16_u (local.get $p)) (i32.const "..")))
                (then
                  (call $emitTok (enum.get $Token.none) (local.get $p) (local.get $lineEnd))
                  (br $emitDone)))
              (call $emitTok (enum.get $Token.punctuation.special)
                (local.get $p) (i32.add (local.get $p) (i32.const 2)))
              (local.set $p (i32.add (local.get $p) (i32.const 2)))

              (local.set $tok (local.get $p))
              (block $commitDone
                (loop $commit
                  (br_if $commitDone (i32.ge_u (local.get $p) (local.get $lineEnd)))
                  (br_if $commitDone (i32.eqz (call $lexIsHex (i32.load8_u (local.get $p)))))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br $commit)))
              (if (i32.eq (local.get $p) (local.get $tok))
                (then
                  (call $emitTok (enum.get $Token.none) (local.get $p) (local.get $lineEnd))
                  (br $emitDone)))
              (call $emitTok (enum.get $Token.constant) (local.get $tok) (local.get $p))

              (local.set $tok (local.get $p))
              (block $spaceDone
                (loop $space
                  (br_if $spaceDone (i32.ge_u (local.get $p) (local.get $lineEnd)))
                  (br_if $spaceDone (i32.eqz (call $lexIsSpace (i32.load8_u (local.get $p)))))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br $space)))
              (call $emitGap (local.get $tok) (local.get $p))
              (local.set $tok (local.get $p))
              (block $modeDone
                (loop $mode
                  (br_if $modeDone (i32.ge_u (local.get $p) (local.get $lineEnd)))
                  (br_if $modeDone (i32.eqz (call $lexIsDigit (i32.load8_u (local.get $p)))))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br $mode)))
              (call $emitTok (enum.get $Token.number) (local.get $tok) (local.get $p))
              (call $emitTok (enum.get $Token.none) (local.get $p) (local.get $lineEnd))
              (br $emitDone)))

          ;; File headers keep their marker pink and color only the path as a diff.
          (if (i32.and
                (i32.or (i32.eq (local.get $c) (i32.const "+"))
                        (i32.eq (local.get $c) (i32.const "-")))
                (i32.and
                  (i32.ge_u (i32.sub (local.get $lineEnd) (local.get $lhs)) (i32.const 4))
                  (i32.and
                    (i32.eq
                      (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff))
                      (select (i32.const "+++") (i32.const "---")
                        (i32.eq (local.get $c) (i32.const "+"))))
                    (call $lexIsSpace (i32.load8_u offset=3 (local.get $lhs))))))
            (then
              (local.set $p (i32.add (local.get $lhs) (i32.const 3)))
              (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (local.get $p))
              (call $emitTok
                (select (enum.get $Token.diff.plus) (enum.get $Token.diff.minus)
                  (i32.eq (local.get $c) (i32.const "+")))
                (local.get $p) (local.get $lineEnd))
              (br $emitDone)))

          ;; Addition/deletion markers are punctuation; only their payload is diff-colored.
          (if (i32.or (i32.eq (local.get $c) (i32.const "+"))
                      (i32.eq (local.get $c) (i32.const "-")))
            (then
              (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
              (block $markerDone
                (loop $marker
                  (br_if $markerDone (i32.ge_u (local.get $p) (local.get $lineEnd)))
                  (br_if $markerDone
                    (i32.ne (i32.load8_u (local.get $p)) (local.get $c)))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br $marker)))
              (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (local.get $p))
              (call $emitTok
                (select (enum.get $Token.diff.plus) (enum.get $Token.diff.minus)
                  (i32.eq (local.get $c) (i32.const "+")))
                (local.get $p) (local.get $lineEnd))
              (br $emitDone)))

          (if (i32.and
                (i32.ge_u (i32.sub (local.get $lineEnd) (local.get $lhs)) (i32.const 2))
                (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "@@")))
            (then
              (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (local.get $lineEnd))
              (br $emitDone)))

          (if (i32.eq (local.get $c) (i32.const "#"))
            (then
              (call $emitTok (enum.get $Token.comment) (local.get $lhs) (local.get $lineEnd))
              (br $emitDone)))

          ;; Similarity metadata is a label, with its score and percent numeric.
          (if (i32.and
                (i32.ge_u (i32.sub (local.get $lineEnd) (local.get $lhs)) (i32.const 16))
                (i32.and
                  (i64.eq (i64.load (local.get $lhs)) (i64.const "similari"))
                  (i64.eq (i64.load offset=8 (local.get $lhs)) (i64.const "ty index"))))
            (then
              (local.set $p (i32.add (local.get $lhs) (i32.const 16)))
              (local.set $tok (local.get $p))
              (block $spaceDone
                (loop $space
                  (br_if $spaceDone (i32.ge_u (local.get $p) (local.get $lineEnd)))
                  (br_if $spaceDone (i32.eqz (call $lexIsSpace (i32.load8_u (local.get $p)))))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br $space)))
              (call $emitTok (enum.get $Token.label) (local.get $lhs) (local.get $p))
              (local.set $tok (local.get $p))
              (block $scoreDone
                (loop $score
                  (br_if $scoreDone (i32.ge_u (local.get $p) (local.get $lineEnd)))
                  (br_if $scoreDone (i32.eqz (call $lexIsDigit (i32.load8_u (local.get $p)))))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br $score)))
              (call $emitTok (enum.get $Token.number) (local.get $tok) (local.get $p))
              (if (i32.and
                    (i32.lt_u (local.get $p) (local.get $lineEnd))
                    (i32.eq (i32.load8_u (local.get $p)) (i32.const "%")))
                (then
                  (call $emitTok (enum.get $Token.number)
                    (local.get $p) (i32.add (local.get $p) (i32.const 1)))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))))
              (call $emitTok (enum.get $Token.label) (local.get $p) (local.get $lineEnd))
              (br $emitDone)))

          ;; File-mode changes are labels with a numeric mode override.
          (local.set $p (i32.const 0))
          (if (i32.and
                (i32.ge_u (i32.sub (local.get $lineEnd) (local.get $lhs)) (i32.const 13))
                (i32.and
                  (i64.eq (i64.load (local.get $lhs)) (i64.const "new file"))
                  (i64.eq
                    (i64.and (i64.load offset=8 (local.get $lhs)) (i64.const 0xffffffffff))
                    (i64.const " mode"))))
            (then (local.set $p (i32.add (local.get $lhs) (i32.const 13)))))
          (if (i32.and
                (i32.ge_u (i32.sub (local.get $lineEnd) (local.get $lhs)) (i32.const 17))
                (i32.and
                  (i64.eq (i64.load (local.get $lhs)) (i64.const "deleted "))
                  (i32.and
                    (i64.eq (i64.load offset=8 (local.get $lhs)) (i64.const "file mod"))
                    (i32.eq (i32.load8_u offset=16 (local.get $lhs)) (i32.const "e")))))
            (then (local.set $p (i32.add (local.get $lhs) (i32.const 17)))))
          (if (i32.and
                (i32.ge_u (i32.sub (local.get $lineEnd) (local.get $lhs)) (i32.const 8))
                (i32.or
                  (i64.eq (i64.load (local.get $lhs)) (i64.const "new mode"))
                  (i64.eq (i64.load (local.get $lhs)) (i64.const "old mode"))))
            (then (local.set $p (i32.add (local.get $lhs) (i32.const 8)))))
          (if (local.get $p)
            (then
              (block $spaceDone
                (loop $space
                  (br_if $spaceDone (i32.ge_u (local.get $p) (local.get $lineEnd)))
                  (br_if $spaceDone (i32.eqz (call $lexIsSpace (i32.load8_u (local.get $p)))))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br $space)))
              (call $emitTok (enum.get $Token.label) (local.get $lhs) (local.get $p))
              (local.set $tok (local.get $p))
              (block $modeDone
                (loop $mode
                  (br_if $modeDone (i32.ge_u (local.get $p) (local.get $lineEnd)))
                  (br_if $modeDone (i32.eqz (call $lexIsDigit (i32.load8_u (local.get $p)))))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br $mode)))
              (call $emitTok (enum.get $Token.number) (local.get $tok) (local.get $p))
              (call $emitTok (enum.get $Token.label) (local.get $p) (local.get $lineEnd))
              (br $emitDone)))

          ;; Rename/copy and binary-change metadata are labels.
          (if (i32.or
                (i32.and
                  (i32.ge_u (i32.sub (local.get $lineEnd) (local.get $lhs)) (i32.const 11))
                  (i32.and
                    (i64.eq (i64.load (local.get $lhs)) (i64.const "rename f"))
                    (i32.eq
                      (i32.and (i32.load offset=8 (local.get $lhs)) (i32.const 0xffffff))
                      (i32.const "rom"))))
                (i32.or
                  (i32.and
                    (i32.ge_u (i32.sub (local.get $lineEnd) (local.get $lhs)) (i32.const 9))
                    (i32.and
                      (i64.eq (i64.load (local.get $lhs)) (i64.const "rename t"))
                      (i32.eq (i32.load8_u offset=8 (local.get $lhs)) (i32.const "o"))))
                  (i32.or
                    (i32.and
                      (i32.ge_u (i32.sub (local.get $lineEnd) (local.get $lhs)) (i32.const 9))
                      (i32.and
                        (i64.eq (i64.load (local.get $lhs)) (i64.const "copy fro"))
                        (i32.eq (i32.load8_u offset=8 (local.get $lhs)) (i32.const "m"))))
                    (i32.and
                      (i32.ge_u (i32.sub (local.get $lineEnd) (local.get $lhs)) (i32.const 7))
                      (i64.eq
                        (i64.and (i64.load (local.get $lhs)) (i64.const 0x00ffffffffffffff))
                        (i64.const "copy to"))))))
            (then
              (call $emitTok (enum.get $Token.label) (local.get $lhs) (local.get $lineEnd))
              (br $emitDone)))

          (if (i32.and
                (i32.ge_u (i32.sub (local.get $lineEnd) (local.get $lhs)) (i32.const 12))
                (i32.and
                  (i64.eq (i64.load (local.get $lhs)) (i64.const "Binary f"))
                  (i32.eq (i32.load offset=8 (local.get $lhs)) (i32.const "iles"))))
            (then
              (call $emitTok (enum.get $Token.label) (local.get $lhs) (local.get $lineEnd))
              (br $emitDone)))

          (call $emitTok (enum.get $Token.none) (local.get $lhs) (local.get $lineEnd)))

        (local.set $lhs (global.get $ptr))
        (block $gapDone
          (loop $gap
            (br_if $gapDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $gapDone (i32.eqz (i32.or
              (i32.eq (local.get $c) (i32.const 10))
              (i32.eq (local.get $c) (i32.const 13)))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $gap)))
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br $line))))
)
