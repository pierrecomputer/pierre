(module
  (import "../common.wat")
  (import "./vhdl.wat")

  ;; Positions where a word counts: 256 at a command start, 512 after an operand,
  ;; 1024 where an operand is expected. From bit 11, the next state: 0-5 a $st
  ;; value, 6 a function header, 7 a command with several expressions.
  (keyword-table $vimlWords $mem.vimlWords $mem.awkWords
    (group $Token.keyword.control+2304 "if" "elseif" "while" "for" "return" "throw")
    (group $Token.keyword.control+4352
      "else" "endif" "endfor" "endwhile" "try" "finally" "endtry" "break" "continue")
    (group $Token.keyword.control+10496 "catch")
    (group $Token.keyword.declaration+12544 "function" "func" "fun" "def")
    (group $Token.keyword.declaration+4352 "endfunction" "endfunc" "endf" "enddef")
    (group $Token.keyword.declaration+2304 "let" "const" "var" "final" "unlet")
    (group $Token.keyword+2304 "call" "eval")
    (group $Token.keyword+14592 "echo" "echom" "echomsg" "echoerr" "echon" "execute" "exe")
    (group $Token.keyword+8448 "set" "setlocal" "setglobal" "setl")
    (group $Token.keyword+6400
      "map" "nmap" "vmap" "xmap" "imap" "cmap" "omap" "noremap" "nnoremap" "vnoremap"
      "xnoremap" "inoremap" "cnoremap" "onoremap" "tnoremap" "unmap" "nunmap" "normal" "norm")
    (group $Token.keyword+10496
      "autocmd" "au" "augroup" "aug" "command" "com" "syntax" "syn" "highlight" "hi"
      "colorscheme" "filetype")
    (group $Token.keyword.import+10496 "source" "runtime" "packadd" "import" "export")
    (group $Token.keyword.import+4352 "vim9script" "finish")
    (group $Token.keyword+256 "silent" "noautocmd" "keepjumps" "vertical" "botright")
    (group $Token.keyword.operator+2560 "is" "isnot" "in")
    (group $Token.keyword+4608 "abort" "range" "dict" "closure")
    (group $Token.boolean+1024 "true" "false")
    (group $Token.constant.builtin+1024 "null"))

  ;; $st: 0 at a command start, 1 before an operand, 2 after an operand, 3 in
  ;; mapping keys, 4 among `set` options, 5 among command words. A `"` opens a
  ;; string before an operand or in a $multi command, else a comment. $bol: a `\`
  ;; before a line's first token continues the line. $fn: 1 after `function`, 2
  ;; in its parameters.
  (func $hlViml
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $v i32)
    (local $hl i32)
    (local $st i32)
    (local $bol i32)
    (local $fn i32)
    (local $multi i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then (local.set $bol (i32.const 1))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (if (local.get $bol)
          (then
            (local.set $bol (i32.const 0))
            ;; a line-start `"` is a comment, also between continuation lines
            (if (i32.eq (local.get $c) (i32.const 34))
              (then
                (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const 92))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (local.set $st (i32.const 0))
            (local.set $fn (i32.const 0))
            (local.set $multi (i32.const 0))))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (if (i32.or (i32.eq (local.get $st) (i32.const 1)) (local.get $multi))
              (then
                (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string))
                (local.set $st (i32.const 2))
                (br $next)))
            (if (i32.ne (local.get $st) (i32.const 3))
              (then
                (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
                (br $next)))))
        ;; a Vim9 `#` comment starts a token where no operand is expected
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "#"))
              (i32.and (i32.ne (local.get $st) (i32.const 1)) (i32.ne (local.get $st) (i32.const 3))))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "|")) (i32.ne (local.get $c2) (i32.const "|")))
          (then
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $st (i32.const 0))
            (local.set $multi (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "<"))
          (then
            (call $scanIdentRun (i32.const "-"))
            (if (i32.and
                  (i32.gt_u (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1)))
                  (i32.eq (call $templateByte (global.get $ptr)) (i32.const ">")))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.constant.builtin) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))))
        (if (i32.eq (local.get $st) (i32.const 3))
          (then
            (block $rawDone
              (loop $raw
                (local.set $v (call $templateByte (global.get $ptr)))
                (br_if $rawDone (i32.or (i32.eqz (local.get $v)) (call $lexIsSpace (local.get $v))))
                (br_if $rawDone (i32.or (i32.eq (local.get $v) (i32.const "<")) (i32.eq (local.get $v) (i32.const "|"))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $raw)))
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (global.set $ptr (local.get $lhs))
            (call $vhdlQuoted (i32.const 39) (enum.get $Token.string))
            (if (i32.lt_u (local.get $st) (i32.const 3))
              (then (local.set $st (i32.const 2))))
            (br $next)))
        (local.set $hl (enum.get $Token.none))
        (if (i32.ne (local.get $st) (i32.const 2))
          (then
            (if (i32.and (i32.eq (local.get $c) (i32.const "&")) (call $lexIsIdentStart (local.get $c2)))
              (then
                (call $scanIdentRun (i32.const ":"))
                (local.set $hl (enum.get $Token.property))))
            (if (i32.and
                  (i32.eq (local.get $c) (i32.const "@"))
                  (i32.and (i32.ne (local.get $c2) (i32.const 0)) (i32.eqz (call $lexIsSpace (local.get $c2)))))
              (then
                (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 2)) (global.get $end)))
                (local.set $hl (enum.get $Token.variable.special))))))
        (if (i32.and (i32.eq (local.get $c) (i32.const "$")) (call $lexIsIdentStart (local.get $c2)))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $hl (enum.get $Token.variable.special))))
        (if (local.get $hl)
          (then
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (if (i32.lt_u (local.get $st) (i32.const 3))
              (then (local.set $st (i32.const 2))))
            (br $next)))
        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            ;; bit n of the mask is the scope letter `a` + n
            (local.set $v (i32.const -1))
            (if (i32.and
                  (i32.eq (local.get $c2) (i32.const ":"))
                  (i32.and
                    (i32.le_u (i32.sub (local.get $c) (i32.const "a")) (i32.const 25))
                    (i32.and
                      (i32.shr_u (i32.const 0x006c0843) (i32.sub (local.get $c) (i32.const "a")))
                      (i32.const 1))))
              (then
                (if (call $lexIsIdentContinue (call $templateByte (i32.add (local.get $lhs) (i32.const 2))))
                  (then
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                    (local.set $v (i32.const -2))))))
            (call $scanIdentRun (i32.const "#"))
            (local.set $c2 (call $templateByte (global.get $ptr)))
            (local.set $hl (enum.get $Token.variable))
            (if (i32.eq (local.get $v) (i32.const -2))
              (then
                (if (i32.eq (local.get $c) (i32.const "a"))
                  (then (local.set $hl (enum.get $Token.variable.parameter))))
                (if (i32.eq (local.get $c) (i32.const "v"))
                  (then (local.set $hl (enum.get $Token.variable.special)))))
              (else
                (local.set $v (keyword-table.value $vimlWords (local.get $lhs) (global.get $ptr)))
                (if (i32.eqz
                      (i32.and
                        (local.get $v)
                        (select
                          (i32.const 256)
                          (select
                            (i32.const 512)
                            (select (i32.const 1024) (i32.const 0) (i32.eq (local.get $st) (i32.const 1)))
                            (i32.eq (local.get $st) (i32.const 2)))
                          (i32.or (i32.eqz (local.get $st)) (i32.eq (local.get $st) (i32.const 5))))))
                  (then (local.set $v (i32.const -1))))))
            (if (i32.ge_s (local.get $v) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $v) (i32.const 255)))
                (local.set $v (i32.shr_u (local.get $v) (i32.const 11)))
                (if (i32.eq (local.get $st) (i32.const 1))
                  (then (local.set $v (i32.const 2))))
                (if (i32.or (i32.eqz (local.get $st)) (i32.eq (local.get $st) (i32.const 5)))
                  (then
                    (if (i32.eq (local.get $c2) (i32.const "!"))
                      (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                    (local.set $multi (i32.eq (local.get $v) (i32.const 7)))
                    (local.set $fn (i32.eq (local.get $v) (i32.const 6)))
                    (if (i32.ge_u (local.get $v) (i32.const 6))
                      (then (local.set $v (i32.const 1))))))
                (local.set $st (local.get $v)))
              (else
                (if (i32.eq (local.get $c2) (i32.const "("))
                  (then (local.set $hl (enum.get $Token.function))))
                (if (i32.eqz (local.get $st))
                  (then
                    (local.set $v (call $templateByte (call $lexSkipSpaceAt (global.get $ptr))))
                    (if (i32.eqz
                          (i32.or
                            (i32.eq (local.get $v) (i32.const "="))
                            (i32.or (i32.eq (local.get $v) (i32.const "[")) (i32.eq (local.get $v) (i32.const ".")))))
                      (then (local.set $hl (enum.get $Token.function))))))
                (if (i32.eq (local.get $st) (i32.const 4))
                  (then (local.set $hl (enum.get $Token.property))))
                (if (i32.eq (local.get $st) (i32.const 5))
                  (then (local.set $hl (enum.get $Token.none))))
                (if (i32.eq (local.get $fn) (i32.const 2))
                  (then
                    (local.set $hl
                      (select
                        (enum.get $Token.type)
                        (enum.get $Token.variable.parameter)
                        (i32.eq (call $lexLineByteBefore (local.get $lhs)) (i32.const ":"))))))
                (if (i32.eq (local.get $fn) (i32.const 1))
                  (then
                    (local.set $hl (enum.get $Token.function.definition))
                    (local.set $fn (i32.const 2))))
                (if (i32.lt_u (local.get $st) (i32.const 3))
                  (then
                    (local.set $st
                      (select
                        (i32.const 1)
                        (i32.const 2)
                        (i32.and (i32.eqz (local.get $st)) (i32.eq (local.get $hl) (enum.get $Token.function)))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (call $lexIsDigit (local.get $c))
          (then
            (global.set $ptr (local.get $lhs))
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (if (i32.lt_u (i32.sub (local.get $st) (i32.const 1)) (i32.const 2))
              (then (local.set $st (i32.const 2))))
            (br $next)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (if (i32.lt_u (local.get $st) (i32.const 3))
              (then
                (local.set $st (select (i32.const 2) (i32.const 1) (byteset.get ")]" (local.get $c))))))
            (if (i32.and (i32.eq (local.get $c) (i32.const ")")) (i32.eq (local.get $fn) (i32.const 2)))
              (then (local.set $fn (i32.const 0))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ","))
          (then
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (if (i32.lt_u (i32.sub (local.get $st) (i32.const 1)) (i32.const 2))
              (then (local.set $st (i32.const 1))))
            (br $next)))
        ;; an option value runs to the next blank that no backslash escapes
        (if (i32.and
              (i32.eq (local.get $st) (i32.const 4))
              (i32.or
                (i32.eq (local.get $c) (i32.const "="))
                (i32.and (i32.eq (local.get $c2) (i32.const "=")) (byteset.get "+-" (local.get $c)))))
          (then
            (if (i32.ne (local.get $c) (i32.const "="))
              (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $lhs (global.get $ptr))
            (block $valueDone
              (loop $value
                (local.set $v (call $templateByte (global.get $ptr)))
                (br_if $valueDone (i32.or (i32.eqz (local.get $v)) (call $lexIsSpace (local.get $v))))
                (br_if $valueDone (i32.eq (local.get $v) (i32.const "|")))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.eq (local.get $v) (i32.const 92))
                  (then
                    (local.set $v (call $templateByte (global.get $ptr)))
                    (if (i32.and (i32.ne (local.get $v) (i32.const 0)) (i32.eqz (byteset.get "\n\r" (local.get $v))))
                      (then
                        (global.set $ptr
                          (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))))))
                (br $value)))
            (local.set $v (call $templateByte (local.get $lhs)))
            (call $emitTok
              (select (enum.get $Token.number) (enum.get $Token.none) (call $lexIsDigit (local.get $v)))
              (local.get $lhs)
              (global.get $ptr))
            (br $next)))
        (if (i32.or
              (i32.eq (local.get $c) (i32.const "."))
              (i32.and
                (byteset.get "!#%&*+-/:<=>?@^|~" (local.get $c))
                (i32.ne (local.get $c) (i32.const "@"))))
          (then
            (block $opDone
              (loop $op
                (local.set $v (call $templateByte (global.get $ptr)))
                (br_if $opDone
                  (i32.eqz
                    (i32.or
                      (i32.eq (local.get $v) (i32.const "."))
                      (i32.and
                        (byteset.get "!#%&*+-/:<=>?@^|~" (local.get $v))
                        (i32.ne (local.get $v) (i32.const "@"))))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (if (i32.lt_u (i32.sub (local.get $st) (i32.const 1)) (i32.const 2))
              (then (local.set $st (i32.const 1))))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
