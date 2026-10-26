(module
  (import "../common.wat")

  ;; Month names (+256) count only before a day number.
  (keyword-table $logWords $mem.logWords $mem.verilogWords
    (group $Token.diff.minus
      "error" "err" "fatal" "ftl" "critical" "crit" "severe" "alert" "emerg" "emergency" "panic"
      "fail" "failed" "failure" "traceback")
    (group $Token.constant "warn" "warning" "wrn")
    (group $Token.diff.plus "info" "inf" "information" "notice")
    (group $Token.comment "debug" "dbg" "trace" "trc" "verbose" "vrb" "fine" "finer" "finest")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "null")
    (group $Token.number+256 "jan" "feb" "mar" "apr" "may" "jun" "jul" "aug" "sep" "oct" "nov" "dec"))

  (func $logIsMark (param $c i32) (result i32)
    (i32.or
      (byteset.get "()[]" (local.get $c))
      (i32.or
        (i32.eq (local.get $c) (i32.const "="))
        (i32.or (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $c) (i32.const "|"))))))

  ;; Plain text collects in one pending run from $plain, emitted before the next
  ;; styled token.
  (func $hlLog
    (local $c i32)
    (local $hl i32)
    (local $lhs i32)
    (local $n i32)
    (local $p i32)
    (local $plain i32)
    (call $lexEmitLeadingContinuation)
    (local.set $plain (global.get $ptr))
    (block $done
      (loop $next
        (call $scanWhitespace)
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $hl (enum.get $Token.none))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (block $classified
          (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
            (then
              (call $scanIdentRun (i32.const 0))
              (local.set $n (i32.sub (global.get $ptr) (local.get $lhs)))
              (local.set $p (call $templateByte (global.get $ptr)))
              (if
                (i32.and
                  (i32.eq (local.get $p) (i32.const ":"))
                  (i32.and
                    (i32.le_u (i32.add (global.get $ptr) (i32.const 3)) (global.get $end))
                    (i32.eq (i32.load16_u offset=1 (global.get $ptr)) (i32.const "//"))))
                (then
                  (local.set $n (i32.add (global.get $ptr) (i32.const 3)))
                  (block $urlDone
                    (loop $url
                      (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                      (br_if $urlDone (i32.ge_u (global.get $ptr) (global.get $end)))
                      (local.set $p (i32.load8_u (global.get $ptr)))
                      (br_if $url (i32.eqz (byteset.get "\09\0a\0b\0c\0d \22'<>" (local.get $p))))))
                  (block $trimDone
                    (loop $trim
                      (br_if $trimDone (i32.le_u (global.get $ptr) (local.get $n)))
                      (local.set $p (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))))
                      (br_if $trimDone
                        (i32.eqz (i32.or (byteset.get ".,;:" (local.get $p)) (byteset.get ")]" (local.get $p)))))
                      (global.set $ptr (i32.sub (global.get $ptr) (i32.const 1)))
                      (br $trim)))
                  (local.set $hl (enum.get $Token.link_uri))
                  (br $classified)))
              (if (i32.le_u (i32.sub (local.get $n) (i32.const 2)) (i32.const 9))
                (then
                  ;; a lowercase level needs a mark beside it, so prose stays plain
                  (if
                    (i32.and
                      (i32.ge_u (local.get $c) (i32.const "a"))
                      (i32.eqz
                        (i32.or
                          (call $logIsMark (local.get $p))
                          (i32.and
                            (i32.gt_u (local.get $lhs) (global.get $srcBase))
                            (call $logIsMark (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))))))))
                    (then
                      (if (i32.eq (local.get $n) (i32.const 4))
                        (then
                          (local.set $hl
                            (select
                              (enum.get $Token.boolean)
                              (select
                                (enum.get $Token.constant.builtin)
                                (enum.get $Token.none)
                                (i32.eq (i32.load (local.get $lhs)) (i32.const "null")))
                              (i32.eq (i32.load (local.get $lhs)) (i32.const "true"))))))
                      (if
                        (i32.and
                          (i32.eq (local.get $n) (i32.const 5))
                          (i32.and
                            (i32.eq (i32.load (local.get $lhs)) (i32.const "fals"))
                            (i32.eq (i32.load8_u offset=4 (local.get $lhs)) (i32.const "e"))))
                        (then (local.set $hl (enum.get $Token.boolean)))))
                    (else
                      (local.set $hl
                        (keyword-table.value $logWords
                          (i32.const $mem.lexLowerScratch)
                          (i32.add
                            (i32.const $mem.lexLowerScratch)
                            (call $lexLowerCopy (local.get $lhs) (global.get $ptr) (i32.const $mem.lexLowerScratch)))))
                      (if (i32.ge_s (local.get $hl) (i32.const 256))
                        (then
                          (local.set $hl
                            (select
                              (enum.get $Token.number)
                              (enum.get $Token.none)
                              (i32.and
                                (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                                (i32.and
                                  (i32.eq (local.get $p) (i32.const 32))
                                  (call $lexIsDigit
                                    (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))))))
                          (br $classified)))
                      (br_if $classified (i32.ge_s (local.get $hl) (i32.const 0)))
                      (local.set $hl (enum.get $Token.none))))
                  (br_if $classified (local.get $hl))))
              (if
                (i32.and
                  (i32.eq (local.get $n) (i32.const 1))
                  (i32.and
                    (i32.eq (local.get $p) (i32.const "]"))
                    (i32.and
                      (i32.gt_u (local.get $lhs) (global.get $srcBase))
                      (i32.eq (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))) (i32.const "[")))))
                (then
                  (local.set $c (i32.and (local.get $c) (i32.const 0xdf)))
                  (if (i32.or (i32.eq (local.get $c) (i32.const "E")) (i32.eq (local.get $c) (i32.const "F")))
                    (then (local.set $hl (enum.get $Token.diff.minus))))
                  (if (i32.eq (local.get $c) (i32.const "W"))
                    (then (local.set $hl (enum.get $Token.constant))))
                  (if (i32.eq (local.get $c) (i32.const "I"))
                    (then (local.set $hl (enum.get $Token.diff.plus))))
                  (if
                    (i32.or
                      (i32.eq (local.get $c) (i32.const "D"))
                      (i32.or (i32.eq (local.get $c) (i32.const "T")) (i32.eq (local.get $c) (i32.const "V"))))
                    (then (local.set $hl (enum.get $Token.comment))))
                  (br $classified)))
              (if
                (i32.and
                  (i32.eq (local.get $n) (i32.const 2))
                  (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "at")))
                (then
                  (local.set $hl
                    (select
                      (enum.get $Token.none)
                      (enum.get $Token.keyword)
                      (call $lexLineByteBefore (local.get $lhs))))
                  (br $classified)))
              (if (i32.eq (local.get $p) (i32.const "("))
                (then
                  (local.set $hl (enum.get $Token.function))
                  (br $classified)))
              (if
                (i32.and
                  (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                  (i32.or
                    (i32.and
                      (i32.ge_u (local.get $n) (i32.const 6))
                      (i32.and
                        (i32.eq (i32.load (i32.sub (global.get $ptr) (i32.const 5))) (i32.const "Erro"))
                        (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const "r"))))
                    (i32.and
                      (i32.ge_u (local.get $n) (i32.const 9))
                      (i32.and
                        (i64.eq (i64.load (i32.sub (global.get $ptr) (i32.const 9))) (i64.const "Exceptio"))
                        (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const "n"))))))
                (then
                  (local.set $hl (enum.get $Token.type))
                  (br $classified)))
              (br_if $classified
                (i32.or
                  (i32.lt_u (local.get $n) (i32.const 7))
                  (i32.eqz (call $lexIsHex (local.get $c)))))
              (local.set $p (local.get $lhs))
              (block $hexDone
                (loop $hex
                  (br_if $hexDone (i32.ge_u (local.get $p) (global.get $ptr)))
                  (local.set $c (i32.load8_u (local.get $p)))
                  (br_if $classified (i32.eqz (call $lexIsHex (local.get $c))))
                  (local.set $hl (i32.or (local.get $hl) (call $lexIsDigit (local.get $c))))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br $hex)))
              (br_if $classified (i32.eqz (local.get $hl)))
              (local.set $c (i32.const "0"))))
          (if (call $lexIsDigit (local.get $c))
            (then
              (call $scanIdentRun (i32.const 0))
              (block $numberDone
                (loop $number
                  (local.set $p (call $templateByte (global.get $ptr)))
                  (br_if $numberDone
                    (i32.eqz (i32.or (byteset.get "+-./:" (local.get $p)) (i32.eq (local.get $p) (i32.const ",")))))
                  (local.set $c (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
                  (br_if $numberDone
                    (i32.eqz
                      (i32.or
                        (call $lexIsHex (local.get $c))
                        (i32.and
                          (i32.eq (local.get $p) (i32.const "/"))
                          (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))))))
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                  (call $scanIdentRun (i32.const 0))
                  (br $number)))
              (local.set $hl (enum.get $Token.number))
              (br $classified)))
          (if (i32.eq (local.get $c) (i32.const 34))
            (then
              (call $emitTok (enum.get $Token.none) (local.get $plain) (local.get $lhs))
              (global.set $ptr (local.get $lhs))
              (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string))
              (local.set $plain (global.get $ptr))
              (br $next)))
          (br_if $classified
            (i32.or
              (i32.ne (local.get $c) (i32.const 39))
              (i32.and
                (i32.gt_u (local.get $lhs) (global.get $srcBase))
                (call $lexIsIdentContinue (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1)))))))
          (local.set $p
            (call $scanFindSpecial (global.get $ptr) (global.get $end) (i32.const 39) (i32.const 0) (i32.const 1)))
          (br_if $classified
            (i32.or
              (i32.ge_u (local.get $p) (global.get $end))
              (i32.ne (i32.load8_u (local.get $p)) (i32.const 39))))
          (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
          (local.set $hl (enum.get $Token.string)))
        (if (local.get $hl)
          (then
            (call $emitTok (enum.get $Token.none) (local.get $plain) (local.get $lhs))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (local.set $plain (global.get $ptr))))
        (br $next)))
    (call $emitTok (enum.get $Token.none) (local.get $plain) (global.get $ptr)))
)
