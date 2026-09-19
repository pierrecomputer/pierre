(module
  (import "../common.wat")

  (func $batchByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0) (i32.lt_u (local.get $p) (global.get $end))))

  (keyword-table $batchWords $mem.batchWords $mem.cWords
    (group $Token.keyword.control "if" "else" "for" "in" "do" "goto" "call" "exit" "not" "exist" "defined" "errorlevel")
    (group $Token.keyword.operator "equ" "neq" "lss" "leq" "gtr" "geq")
    (group $Token.keyword.declaration "set" "setlocal" "endlocal")
    (group $Token.function
      "echo" "echo." "cd" "chdir" "cls" "copy" "del" "dir" "erase" "md" "mkdir" "move"
      "path" "pause" "popd" "pushd" "rd" "ren" "rename" "rmdir" "shift" "start" "title"
      "type" "ver" "verify" "vol" "assoc" "ftype" "color" "prompt" "mklink" "choice")
    (group $Token.comment "rem"))

  ;; Percent arguments and FOR variables have no closing delimiter; environment
  ;; and delayed expansions do. This endpoint is shared by quoted and bare text.
  (func $batchVariableEnd (param $lhs i32) (param $variables i64) (result i32)
    (local $p i32)
    (local $mark i32)
    (local $c i32)
    (local $for i32)
    (local $variableEnd i32)
    (local.set $mark (i32.load8_u (local.get $lhs)))
    (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
    (if (i32.eq (local.get $mark) (i32.const "%"))
      (then
        (local.set $c (call $batchByte (local.get $p)))
        (if (i32.or (call $lexIsDigit (local.get $c)) (i32.eq (local.get $c) (i32.const "*")))
          (then (return (i32.add (local.get $p) (i32.const 1)))))
        (if (i32.or (i32.eq (local.get $c) (i32.const "%")) (i32.eq (local.get $c) (i32.const "~")))
          (then
            (if (i32.eq (local.get $c) (i32.const "%"))
              (then
                (local.set $for (i32.const 1))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))))
            (if (i32.eq (call $batchByte (local.get $p)) (i32.const "~"))
              (then
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (block $modifiedDone
                  (loop $modified
                    (local.set $c (call $batchByte (local.get $p)))
                    ;; A search-path modifier ends at `:`, followed by one variable.
                    (if (i32.eq (local.get $c) (i32.const "$"))
                      (then
                        (local.set $variableEnd (i32.const 0))
                        (local.set $p (i32.add (local.get $p) (i32.const 1)))
                        (block $pathDone
                          (loop $path
                            (br_if $pathDone (i32.eqz (call $lexIsIdentContinue (call $batchByte (local.get $p)))))
                            (local.set $p (i32.add (local.get $p) (i32.const 1)))
                            (br $path)))
                        (if (i32.eq (call $batchByte (local.get $p)) (i32.const ":"))
                          (then
                            (local.set $p (i32.add (local.get $p) (i32.const 1)))
                            (if (call $lexIsIdentContinue (call $batchByte (local.get $p)))
                              (then (local.set $p (call $utf8SpanEnd (i32.add (local.get $p) (i32.const 1)) (global.get $end)))))))
                        (br $modifiedDone)))
                    (br_if $modifiedDone (i32.eqz
                      (i32.or (call $lexIsDigit (local.get $c))
                        (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25)))))
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br_if $modifiedDone (call $lexIsDigit (local.get $c)))
                    ;; Prefer the last known name in a modifier run: %%~ff
                    ;; is the full-path modifier followed by the variable f.
                    (if (i32.and (local.get $for)
                      (i64.ne (i64.and (local.get $variables)
                        (i64.shl (i64.const 1) (i64.extend_i32_u (i32.sub (local.get $c) (i32.const "A"))))) (i64.const 0)))
                      (then (local.set $variableEnd (local.get $p))))
                    (local.set $c (i32.or (local.get $c) (i32.const 32)))
                    (br_if $modifiedDone (i32.eqz (byteset.get "fdpnxsatz" (local.get $c))))
                    (br $modified))))
              (else
                (if (call $lexIsIdentContinue (call $batchByte (local.get $p)))
                  (then (local.set $p (call $utf8SpanEnd (i32.add (local.get $p) (i32.const 1)) (global.get $end)))))))
            (return (select (local.get $variableEnd) (local.get $p) (local.get $variableEnd)))))))
    (block $missing
      (loop $find
        (br_if $missing (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $missing (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
        (if (i32.eq (local.get $c) (local.get $mark))
          (then (return (i32.add (local.get $p) (i32.const 1)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $find)))
    (local.get $lhs))

  ;; Command position distinguishes REM comments and labels from echo arguments.
  ;; A caret-newline keeps that position; an ordinary newline resets it.
  (func $hlBatch
    (local $c i32)
    (local $lhs i32)
    (local $p i32)
    (local $n i32)
    (local $hl i32)
    (local $argument i32)
    (local $quote i32)
    (local $label i32)
    (local $variables i64) ;; case-sensitive FOR names seen in unmodified %%A references
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (local.set $argument (i32.const 0))
            (local.set $quote (i32.const 0))
            (local.set $label (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $quote (i32.eqz (local.get $quote)))
            (local.set $argument (i32.const 1))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "%")) (i32.eq (local.get $c) (i32.const "!")))
          (then
            (local.set $p (call $batchVariableEnd (local.get $lhs) (local.get $variables)))
            (if (i32.gt_u (local.get $p) (local.get $lhs))
              (then
                (if (i32.and
                      (i32.eq (i32.sub (local.get $p) (local.get $lhs)) (i32.const 3))
                      (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "%%")))
                  (then
                    (local.set $n (i32.load8_u offset=2 (local.get $lhs)))
                    (if (i32.le_u (i32.sub (i32.or (local.get $n) (i32.const 32)) (i32.const "a")) (i32.const 25))
                      (then (local.set $variables (i64.or (local.get $variables)
                        (i64.shl (i64.const 1) (i64.extend_i32_u (i32.sub (local.get $n) (i32.const "A"))))))))))
                (global.set $ptr (local.get $p))
                (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
                (br $next)))))
        (if (local.get $quote)
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (block $quotedDone
              (loop $quoted
                (br_if $quotedDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $p (i32.load8_u (global.get $ptr)))
                (br_if $quotedDone (byteset.get "\22%!\0a\0d" (local.get $p)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $quoted)))
            (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (call $lexIsSpace (local.get $c))
          (then
            (global.set $ptr (call $lexSkipSpaceAt (local.get $lhs)))
            (if (i32.eq (global.get $ptr) (local.get $lhs))
              (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "^"))
          (then
            (global.set $ptr (call $lexEscapeEnd (local.get $lhs)))
            (call $emitTok (enum.get $Token.string.escape) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.and (i32.eqz (local.get $argument)) (i32.eq (local.get $c) (i32.const ":")))
          (then
            (call $lexLineComment (i32.const 1)
              (select (enum.get $Token.comment) (enum.get $Token.label)
                (i32.eq (call $batchByte (i32.add (local.get $lhs) (i32.const 1))) (i32.const ":"))))
            (br $next)))
        (if (i32.or (call $lexIsIdentStart (local.get $c))
              (i32.and (local.get $label) (i32.eq (local.get $c) (i32.const ":"))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $lexScanIdent)
            (local.set $n (call $lexLowerCopy (local.get $lhs) (global.get $ptr) (i32.const $mem.lexLowerScratch)))
            (local.set $hl (keyword-table.value $batchWords (i32.const $mem.lexLowerScratch)
              (i32.add (i32.const $mem.lexLowerScratch) (local.get $n))))
            (if (i32.and (i32.eq (local.get $hl) (enum.get $Token.comment)) (i32.eqz (local.get $argument)))
              (then
                (call $scanToLineEnd)
                (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (if (i32.or (i32.lt_s (local.get $hl) (i32.const 0)) (i32.eq (local.get $hl) (enum.get $Token.comment)))
              (then (local.set $hl (enum.get $Token.variable))))
            (if (local.get $label)
              (then (local.set $hl (enum.get $Token.label))))
            (local.set $label
              (i32.and (i32.eq (local.get $n) (i32.const 4))
                (i32.eq (i32.load (i32.const $mem.lexLowerScratch)) (i32.const "goto"))))
            (local.set $argument (i32.const 1))
            (if (i32.eq (local.get $hl) (enum.get $Token.keyword.control))
              (then
                (if (i32.or
                      (i32.and (i32.eq (local.get $n) (i32.const 2))
                        (i32.eq (i32.load16_u (i32.const $mem.lexLowerScratch)) (i32.const "do")))
                      (i32.and (i32.eq (local.get $n) (i32.const 4))
                        (i32.or (i32.eq (i32.load (i32.const $mem.lexLowerScratch)) (i32.const "call"))
                          (i32.eq (i32.load (i32.const $mem.lexLowerScratch)) (i32.const "else")))))
                  (then (local.set $argument (i32.const 0))))))
            ;; CALL's :label is one argument, unlike a line-start label.
            (if (i32.and (i32.eq (local.get $n) (i32.const 4))
                  (i32.eq (i32.load (i32.const $mem.lexLowerScratch)) (i32.const "call")))
              (then
                (if (i32.eq (call $batchByte (call $lexSkipSpaceAt (global.get $ptr))) (i32.const ":"))
                  (then
                    (local.set $label (i32.const 1))
                    (local.set $argument (i32.const 1))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (call $lexIsDigit (local.get $c))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 1)) (global.get $end)))
        (local.set $hl (enum.get $Token.none))
        (if (byteset.get "()" (local.get $c))
          (then (local.set $hl (enum.get $Token.punctuation.bracket))))
        (if (byteset.get "@&|<>=+-*/%!" (local.get $c))
          (then (local.set $hl (enum.get $Token.operator))))
        (if (byteset.get ":;," (local.get $c))
          (then (local.set $hl (enum.get $Token.punctuation.delimiter))))
        (if (byteset.get "&|()" (local.get $c))
          (then (local.set $argument (i32.const 0))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
