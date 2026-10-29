(module
  (import "../emit.wat")
  (import "../styles.wat")
  (import "../scan.wat")
  (global $ansiFg (mut i32) (i32.const 0))
  (global $ansiBg (mut i32) (i32.const -1))
  (global $ansiFlags (mut i32) (i32.const 0))
  (global $ansiParam (mut i32) (i32.const 0))
  (global $ansiParamEnd (mut i32) (i32.const 0))
  (func $ansiNumber
    (result i32)
    (local $n i32)
    (local $c i32)
    (local $valid i32)
    (if (i32.gt_u (global.get $ansiParam) (global.get $ansiParamEnd)) (then (return (i32.const -1))))
    (local.set $valid (i32.const 1))
    (block $done
      (loop $digits
        (br_if $done (i32.ge_u (global.get $ansiParam) (global.get $ansiParamEnd)))
        (local.set $c (i32.load8_u (global.get $ansiParam)))
        (br_if $done (i32.eq (local.get $c) (i32.const 59)))
        (global.set $ansiParam (i32.add (global.get $ansiParam) (i32.const 1)))
        (if
          (i32.le_u (i32.sub (local.get $c) (i32.const 48)) (i32.const 9))
          (then
            (if
              (i32.lt_u (local.get $n) (i32.const 65536))
              (then
                (local.set $n
                  (i32.add
                    (i32.mul (local.get $n) (i32.const 10))
                    (i32.sub (local.get $c) (i32.const 48)))))))
          (else (local.set $valid (i32.const 0))))
        (br $digits)))
    (global.set $ansiParam (i32.add (global.get $ansiParam) (i32.const 1)))
    (select (local.get $n) (i32.const -1) (local.get $valid)))
  (func $ansiColor
    (param $n i32)
    (result i32)
    (local $r i32)
    (local $g i32)
    (local $b i32)
    (if
      (i32.lt_u (local.get $n) (i32.const 16))
      (then (return (i32.add (enum.get $Token.terminal.ansi.black) (local.get $n)))))
    (if
      (i32.ge_u (local.get $n) (i32.const 232))
      (then
        (return
          (i32.or
            (i32.const 0x1000000)
            (i32.mul
              (i32.add (i32.const 8) (i32.mul (i32.sub (local.get $n) (i32.const 232)) (i32.const 10)))
              (i32.const 0x10101))))))
    (local.set $n (i32.sub (local.get $n) (i32.const 16)))
    (local.set $r (i32.div_u (local.get $n) (i32.const 36)))
    (local.set $g (i32.rem_u (i32.div_u (local.get $n) (i32.const 6)) (i32.const 6)))
    (local.set $b (i32.rem_u (local.get $n) (i32.const 6)))
    (local.set $r
      (select
        (i32.add (i32.const 55) (i32.mul (local.get $r) (i32.const 40)))
        (i32.const 0)
        (local.get $r)))
    (local.set $g
      (select
        (i32.add (i32.const 55) (i32.mul (local.get $g) (i32.const 40)))
        (i32.const 0)
        (local.get $g)))
    (local.set $b
      (select
        (i32.add (i32.const 55) (i32.mul (local.get $b) (i32.const 40)))
        (i32.const 0)
        (local.get $b)))
    (i32.or
      (i32.const 0x1000000)
      (i32.or
        (i32.shl (local.get $r) (i32.const 16))
        (i32.or (i32.shl (local.get $g) (i32.const 8)) (local.get $b)))))
  (func $hlAnsi
    (local $start i32)
    (local $escape i32)
    (local $p i32)
    (local $q i32)
    (local $c i32)
    (local $params i32)
    (local $paramsEnd i32)
    (local $n i32)
    (local $bit i32)
    (local $mode i32)
    (local $r i32)
    (local $g i32)
    (local $b i32)
    (local $color i32)
    ;; Warning: live editor records must cover the original control sequences.
    (if
      (i32.ne (global.get $srcBase) (i32.const $mem.input))
      (then
        (call $emitTok (enum.get $Token.none) (global.get $ptr) (global.get $end))
        (global.set $ptr (global.get $end))
        (return)))
    (if
      (i32.or (i32.eqz (global.get $streaming)) (global.get $streamReset))
      (then
        (global.set $ansiFg (enum.get $Token.foreground))
        (global.set $ansiBg (i32.const -1))
        (global.set $ansiFlags (i32.const 0))))
    (call $lexEmitLeadingContinuation)
    (local.set $start (global.get $ptr))
    (block $done
      (loop $scan
        (local.set $escape
          (call $scanFindSpecial
            (global.get $ptr)
            (global.get $end)
            (i32.const 27)
            (i32.const 0)
            (i32.const 0)))
        (if
          (i32.ge_u (local.get $escape) (global.get $end))
          (then
            (call $emitStyled
              (global.get $ansiFg)
              (global.get $ansiBg)
              (global.get $ansiFlags)
              (local.get $start)
              (global.get $end))
            (global.set $ptr (global.get $end))
            (br $done)))
        (local.set $p (i32.add (local.get $escape) (i32.const 1)))
        (local.set $params (i32.const 0))
        (block $matched
          (if
            (i32.lt_u (local.get $p) (global.get $end))
            (then
              (local.set $c (i32.load8_u (local.get $p)))
              (if
                (i32.eq (local.get $c) (i32.const 91))
                (then
                  (local.set $q (i32.add (local.get $p) (i32.const 1)))
                  (local.set $paramsEnd (local.get $q))
                  (block $parameters
                    (loop $parameter
                      (br_if $parameters (i32.ge_u (local.get $paramsEnd) (global.get $end)))
                      (br_if $parameters
                        (i32.gt_u
                          (i32.sub (i32.load8_u (local.get $paramsEnd)) (i32.const 48))
                          (i32.const 15)))
                      (local.set $paramsEnd (i32.add (local.get $paramsEnd) (i32.const 1)))
                      (br $parameter)))
                  (local.set $q (local.get $paramsEnd))
                  (block $intermediates
                    (loop $intermediate
                      (br_if $intermediates (i32.ge_u (local.get $q) (global.get $end)))
                      (br_if $intermediates
                        (i32.gt_u (i32.sub (i32.load8_u (local.get $q)) (i32.const 32)) (i32.const 15)))
                      (local.set $q (i32.add (local.get $q) (i32.const 1)))
                      (br $intermediate)))
                  (if
                    (i32.lt_u (local.get $q) (global.get $end))
                    (then
                      (local.set $c (i32.load8_u (local.get $q)))
                      (if
                        (i32.le_u (i32.sub (local.get $c) (i32.const 64)) (i32.const 62))
                        (then
                          (if
                            (i32.and
                              (i32.eq (local.get $c) (i32.const 109))
                              (i32.or
                                (i32.eq (local.get $paramsEnd) (i32.add (local.get $p) (i32.const 1)))
                                (i32.lt_u (i32.load8_u offset=1 (local.get $p)) (i32.const 60))))
                            (then (local.set $params (i32.add (local.get $p) (i32.const 1)))))
                          (local.set $p (i32.add (local.get $q) (i32.const 1)))
                          (br $matched)))))))
              (if
                (i32.eq (i32.load8_u (local.get $p)) (i32.const 93))
                (then
                  (local.set $q (i32.add (local.get $p) (i32.const 1)))
                  (block $oscEnd
                    (loop $osc
                      (br_if $oscEnd (i32.ge_u (local.get $q) (global.get $end)))
                      (local.set $c (i32.load8_u (local.get $q)))
                      (br_if $oscEnd (i32.eq (local.get $c) (i32.const 10)))
                      (if
                        (i32.eq (local.get $c) (i32.const 7))
                        (then (local.set $p (i32.add (local.get $q) (i32.const 1))) (br $matched)))
                      (if
                        (i32.eq (local.get $c) (i32.const 27))
                        (then
                          (if
                            (i32.and
                              (i32.lt_u (i32.add (local.get $q) (i32.const 1)) (global.get $end))
                              (i32.eq (i32.load8_u offset=1 (local.get $q)) (i32.const 92)))
                            (then (local.set $p (i32.add (local.get $q) (i32.const 2))) (br $matched)))
                          (br $oscEnd)))
                      (local.set $q (i32.add (local.get $q) (i32.const 1)))
                      (br $osc)))))
              (local.set $q (local.get $p))
              (block $shortEnd
                (loop $short
                  (br_if $shortEnd (i32.ge_u (local.get $q) (global.get $end)))
                  (br_if $shortEnd
                    (i32.gt_u (i32.sub (i32.load8_u (local.get $q)) (i32.const 32)) (i32.const 15)))
                  (local.set $q (i32.add (local.get $q) (i32.const 1)))
                  (br $short)))
              (if
                (i32.and
                  (i32.lt_u (local.get $q) (global.get $end))
                  (i32.le_u (i32.sub (i32.load8_u (local.get $q)) (i32.const 48)) (i32.const 78)))
                (then (local.set $p (i32.add (local.get $q) (i32.const 1))) (br $matched)))))
          (global.set $ptr (i32.add (local.get $escape) (i32.const 1)))
          (br $scan))
        (call $emitStyled
          (global.get $ansiFg)
          (global.get $ansiBg)
          (global.get $ansiFlags)
          (local.get $start)
          (local.get $escape))
        (call $emitHidden (local.get $p))
        (if
          (local.get $params)
          (then
            (global.set $ansiParam (local.get $params))
            (global.set $ansiParamEnd (local.get $paramsEnd))
            (loop $sgr
              (local.set $n (call $ansiNumber))
              (block $applied
                (if
                  (i32.eqz (local.get $n))
                  (then
                    (global.set $ansiFg (enum.get $Token.foreground))
                    (global.set $ansiBg (i32.const -1))
                    (global.set $ansiFlags (i32.const 0))
                    (br $applied)))
                (local.set $bit (i32.const 0))
                (local.set $c
                  (select
                    (i32.sub (local.get $n) (i32.const 20))
                    (local.get $n)
                    (i32.gt_u (local.get $n) (i32.const 20))))
                (if
                  (i32.le_u (i32.sub (local.get $c) (i32.const 1)) (i32.const 3))
                  (then (local.set $bit (i32.shl (i32.const 1) (i32.sub (local.get $c) (i32.const 1))))))
                (if (i32.eq (local.get $c) (i32.const 7)) (then (local.set $bit (i32.const 16))))
                (if (i32.eq (local.get $c) (i32.const 9)) (then (local.set $bit (i32.const 32))))
                (if (i32.eq (local.get $n) (i32.const 22)) (then (local.set $bit (i32.const 3))))
                (if
                  (local.get $bit)
                  (then
                    (global.set $ansiFlags
                      (if
                        (result i32)
                        (i32.gt_u (local.get $n) (i32.const 20))
                        (then
                          (i32.and (global.get $ansiFlags) (i32.xor (local.get $bit) (i32.const -1))))
                        (else (i32.or (global.get $ansiFlags) (local.get $bit)))))
                    (br $applied)))
                (if
                  (i32.le_u (i32.sub (local.get $n) (i32.const 30)) (i32.const 7))
                  (then
                    (global.set $ansiFg (call $ansiColor (i32.sub (local.get $n) (i32.const 30))))
                    (br $applied)))
                (if
                  (i32.le_u (i32.sub (local.get $n) (i32.const 40)) (i32.const 7))
                  (then
                    (global.set $ansiBg (call $ansiColor (i32.sub (local.get $n) (i32.const 40))))
                    (br $applied)))
                (if
                  (i32.le_u (i32.sub (local.get $n) (i32.const 90)) (i32.const 7))
                  (then
                    (global.set $ansiFg (call $ansiColor (i32.sub (local.get $n) (i32.const 82))))
                    (br $applied)))
                (if
                  (i32.le_u (i32.sub (local.get $n) (i32.const 100)) (i32.const 7))
                  (then
                    (global.set $ansiBg (call $ansiColor (i32.sub (local.get $n) (i32.const 92))))
                    (br $applied)))
                (if
                  (i32.eq (local.get $n) (i32.const 39))
                  (then (global.set $ansiFg (enum.get $Token.foreground)) (br $applied)))
                (if
                  (i32.eq (local.get $n) (i32.const 49))
                  (then (global.set $ansiBg (i32.const -1)) (br $applied)))
                (if
                  (i32.or (i32.eq (local.get $n) (i32.const 38)) (i32.eq (local.get $n) (i32.const 48)))
                  (then
                    (local.set $mode (call $ansiNumber))
                    (local.set $color (i32.const -1))
                    (if
                      (i32.eq (local.get $mode) (i32.const 5))
                      (then
                        (local.set $c (call $ansiNumber))
                        (if
                          (i32.lt_u (local.get $c) (i32.const 256))
                          (then (local.set $color (call $ansiColor (local.get $c)))))))
                    (if
                      (i32.eq (local.get $mode) (i32.const 2))
                      (then
                        (local.set $r (call $ansiNumber))
                        (local.set $g (call $ansiNumber))
                        (local.set $b (call $ansiNumber))
                        (if
                          (i32.ge_s
                            (i32.or (local.get $r) (i32.or (local.get $g) (local.get $b)))
                            (i32.const 0))
                          (then
                            (local.set $r
                              (select
                                (local.get $r)
                                (i32.const 255)
                                (i32.lt_u (local.get $r) (i32.const 255))))
                            (local.set $g
                              (select
                                (local.get $g)
                                (i32.const 255)
                                (i32.lt_u (local.get $g) (i32.const 255))))
                            (local.set $b
                              (select
                                (local.get $b)
                                (i32.const 255)
                                (i32.lt_u (local.get $b) (i32.const 255))))
                            (local.set $color
                              (i32.or
                                (i32.const 0x1000000)
                                (i32.or
                                  (i32.shl (local.get $r) (i32.const 16))
                                  (i32.or (i32.shl (local.get $g) (i32.const 8)) (local.get $b)))))))))
                    (if
                      (i32.ge_s (local.get $color) (i32.const 0))
                      (then
                        (if
                          (i32.eq (local.get $n) (i32.const 38))
                          (then (global.set $ansiFg (local.get $color)))
                          (else (global.set $ansiBg (local.get $color)))))))))
              (br_if $sgr (i32.le_u (global.get $ansiParam) (global.get $ansiParamEnd))))))
        (global.set $ptr (local.get $p))
        (local.set $start (local.get $p))
        (br $scan)))))
