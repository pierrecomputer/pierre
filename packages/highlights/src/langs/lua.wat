(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (memory-region $mem.luaWords 96)

  (import "@pierre/wat-tools/common.wat")

  (func $luaLong (param $prefix i32) (param $hl i32) (result i32)
    (local $bracket i32)
    (local $c i32)
    (local $eq i32)
    (local $i i32)
    (local $lhs i32)
    (local $p i32)
    (local $closed i32)
    (local.set $lhs (global.get $ptr))
    (local.set $bracket (i32.add (global.get $ptr) (local.get $prefix)))
    (if (i32.ge_u (local.get $bracket) (global.get $end))
      (then (return (i32.const 0))))
    (if (i32.ne (i32.load8_u (local.get $bracket)) (i32.const "["))
      (then (return (i32.const 0))))
    (local.set $p (i32.add (local.get $bracket) (i32.const 1)))
    (block $openDone
      (loop $open
        (br_if $openDone (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $openDone (i32.ne (local.get $c) (i32.const "=")))
        (local.set $eq (i32.add (local.get $eq) (i32.const 1)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $open)))
    (if
      (i32.or
        (i32.ge_u (local.get $p) (global.get $end))
        (i32.ne (i32.load8_u (local.get $p)) (i32.const "[")))
      (then (return (i32.const 0))))
    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
    (block $done
      (loop $scan
        (global.set $ptr (call $lexFindByte (global.get $ptr) (i32.const "]")))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $p (i32.add (global.get $ptr) (i32.const 1)))
        (local.set $i (i32.const 0))
        (block $eqDone
          (loop $closeEq
            (br_if $eqDone (i32.ge_u (local.get $i) (local.get $eq)))
            (br_if $eqDone (i32.ge_u (local.get $p) (global.get $end)))
            (br_if $eqDone (i32.ne (i32.load8_u (local.get $p)) (i32.const "=")))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $closeEq)))
        (if
          (i32.and
            (i32.eq (local.get $i) (local.get $eq))
            (i32.and
              (i32.lt_u (local.get $p) (global.get $end))
              (i32.eq (i32.load8_u (local.get $p)) (i32.const "]"))))
          (then
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (local.set $closed (i32.const 1))
            (br $done)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
    ;; An open long bracket continues in the next stream chunk with its
    ;; closing `]=...=]` as the fixed delimiter. Build it only when streaming
    ;; and only when it fits the 32-byte delimiter region: the bytes past
    ;; that region hold the lexer checkpoints and keyword tables, and a
    ;; `--[` followed by thousands of `=` must not overwrite them. A longer
    ;; delimiter simply ends the token at the chunk, like $streamSetFixed.
    (if
      (i32.and
        (i32.eqz (local.get $closed))
        (i32.and
          (global.get $streaming)
          (i32.le_u (i32.add (local.get $eq) (i32.const 2)) (i32.const 32))))
      (then
        (i32.store8 (i32.const $mem.streamDelimiter) (i32.const "]"))
        (memory.fill (i32.const $mem.streamDelimiter+1) (i32.const "=") (local.get $eq))
        (i32.store8 (i32.add (i32.const $mem.streamDelimiter+1) (local.get $eq)) (i32.const "]"))
        (call $streamSetFixed
          (i32.const $mem.streamDelimiter)
          (i32.add (local.get $eq) (i32.const 2))
          (local.get $hl))))
    (i32.const 1))

  ;; $skip 1 resumes inside `\z` blanks, 2 after an escaped line break. Returns
  ;; the quote while the string runs past $end (plus 256 inside `\z` blanks), else 0.
  (func $luaStringTail (param $quote i32) (param $skip i32) (param $seg i32) (result i32)
    (local $c i32)
    (local $n i32)
    (local $p i32)
    (loop $more
      (if (i32.eqz (local.get $skip))
        (then
          (if (i32.ge_u (global.get $ptr) (global.get $end))
            (then
              ;; take over the shared escaped-line-break resume so `\z` works after it
              (if (i32.eq (global.get $streamMode) (i32.const 2))
                (then
                  (global.set $streamMode (i32.const 0))
                  (return (local.get $quote))))
              (return (i32.const 0))))
          (local.set $c (i32.load8_u (global.get $ptr)))
          (if (i32.and (i32.ne (local.get $c) (i32.const 10)) (i32.ne (local.get $c) (i32.const 13)))
            (then (return (i32.const 0))))
          (local.set $p (global.get $ptr))
          (block $blanks
            (loop $back
              (br_if $blanks (i32.le_u (local.get $p) (local.get $seg)))
              (local.set $c (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))
              (br_if $blanks
                (i32.and
                  (i32.ne (local.get $c) (i32.const 32))
                  (i32.gt_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4))))
              (local.set $p (i32.sub (local.get $p) (i32.const 1)))
              (br $back)))
          (if
            (i32.or
              (i32.lt_u (i32.sub (local.get $p) (local.get $seg)) (i32.const 2))
              (i32.ne (i32.load16_u (i32.sub (local.get $p) (i32.const 2))) (i32.const "\\z")))
            (then (return (i32.const 0))))
          (local.set $p (i32.sub (local.get $p) (i32.const 2)))
          (local.set $n (i32.const 0))
          (block $run
            (loop $slash
              (br_if $run (i32.le_u (local.get $p) (local.get $seg)))
              (br_if $run (i32.ne (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const 92)))
              (local.set $n (i32.xor (local.get $n) (i32.const 1)))
              (local.set $p (i32.sub (local.get $p) (i32.const 1)))
              (br $slash)))
          (if (local.get $n)
            (then (return (i32.const 0))))))
      (if (i32.lt_u (local.get $skip) (i32.const 2))
        (then
          (local.set $p (global.get $ptr))
          (call $scanWhitespace)
          (call $emitTok (enum.get $Token.string) (local.get $p) (global.get $ptr))
          (if (i32.ge_u (global.get $ptr) (global.get $end))
            (then (return (i32.or (local.get $quote) (i32.const 256)))))))
      (local.set $seg (global.get $ptr))
      (local.set $c
        (call $lexStringBody (local.get $quote) (i32.const 0) (enum.get $Token.string) (global.get $ptr)))
      (if (i32.eq (local.get $c) (i32.const 1))
        (then (return (i32.const 0))))
      (if (i32.eq (local.get $c) (i32.const 2))
        (then (return (local.get $quote))))
      (local.set $skip (i32.const 0))
      (br $more))
    (i32.const 0))

  ;; Each value is the word's token; `function` adds 256 to mark that the
  ;; next name is a function definition. A miss is an ordinary name, which
  ;; $hlLua may still promote to a call or a property.
  (keyword-table $luaWords $mem.luaWords $mem.luaWords+96
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "nil")
    (group $Token.keyword.operator "and" "not" "in" "or")
    (group $Token.keyword.control
      "do" "if" "end" "for" "else" "then" "break" "until" "while" "repeat" "elseif")
    (group $Token.keyword.declaration "local")
    (group $Token.keyword.declaration+256 "function")
    (group $Token.keyword "goto" "return"))

  (func $hlLua
    (local $c i32)
    (local $decl i32)
    (local $group i32)
    (local $hl i32)
    (local $lhs i32)
    (local $member i32)
    (local $next i32)
    (local $p i32)
    (local $zq i32) ;; quote of a string left open after `\z` at a chunk end
    (call $lexEmitLeadingContinuation)
    (if (local.get $zq)
      (then (local.set $zq (call $luaStringTail
          (i32.and (local.get $zq) (i32.const 255))
          (i32.sub (i32.const 2) (i32.shr_u (local.get $zq) (i32.const 8)))
          (global.get $ptr)))))
    (block $done
      (loop $token
        (local.set $lhs (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $next
          (select
            (i32.load8_u offset=1 (global.get $ptr))
            (i32.const 0)
            (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "-"))
            (i32.eq (local.get $next) (i32.const "-")))
          (then
            (if (call $luaLong (i32.const 2) (enum.get $Token.comment))
              (then (br $token)))
            (call $lexLineComment
              (i32.const 2)
              (select
                (enum.get $Token.comment.doc)
                (enum.get $Token.comment)
                (i32.and
                  (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
                  (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (i32.const "-")))))
            (br $token)))
        ;; a `#!` shebang line: Lua skips a first line starting with `#`, and
        ;; `#!` is never code anywhere else (`#` is length, and there is no
        ;; `!` operator), so no first-line tracking is needed
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "#"))
            (i32.eq (local.get $next) (i32.const "!")))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (br $token)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (if (i32.ne (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (local.get $c))
              (then (local.set $zq (call $luaStringTail (local.get $c) (i32.const 0) (local.get $lhs)))))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (br $token)))
        (if (i32.eq (local.get $c) (i32.const "["))
          (then
            (if (call $luaLong (i32.const 0) (enum.get $Token.string))
              (then
                (local.set $decl (i32.const 0))
                (local.set $member (i32.const 0))
                (br $token)))))
        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $next))))
          (then
            (call $lexScanHexNumber (i32.const 0))
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (br $token)))
        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $group (keyword-table.value $luaWords (local.get $lhs) (global.get $ptr)))
            (local.set $hl
              (select
                (enum.get $Token.variable)
                (i32.and (local.get $group) (i32.const 255))
                (i32.lt_s (local.get $group) (i32.const 0))))
            (if (local.get $decl)
              (then
                (local.set $hl (enum.get $Token.function.definition))
                (local.set $decl (i32.const 0)))
              (else
                (if (local.get $member)
                  (then
                    (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                    (local.set $hl
                      (select
                        (enum.get $Token.function.method)
                        (enum.get $Token.property)
                        (i32.and
                          (i32.lt_u (local.get $p) (global.get $end))
                          (i32.eq (i32.load8_u (local.get $p)) (i32.const "(")))))
                    (local.set $member (i32.const 0)))
                  (else
                    (if (i32.eq (local.get $hl) (enum.get $Token.variable))
                      (then
                        (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                        (if
                          (i32.and
                            (i32.lt_u (local.get $p) (global.get $end))
                            (i32.eq (i32.load8_u (local.get $p)) (i32.const "(")))
                          (then (local.set $hl (enum.get $Token.function))))))))))
            ;; `function` opens a definition; the token test keeps a `function`
            ;; that was itself captured as a definition from opening another one
            (if
              (i32.and
                (i32.eq (local.get $hl) (enum.get $Token.keyword.declaration))
                (i32.gt_s (local.get $group) (i32.const 255)))
              (then (local.set $decl (i32.const 1))))
            (if (call $lexIsConstCase (local.get $lhs) (global.get $ptr))
              (then
                (if (i32.eq (local.get $hl) (enum.get $Token.variable))
                  (then (local.set $hl (enum.get $Token.constant))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $token)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c) (i32.const ":")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if
              (i32.and
                (i32.lt_u (global.get $ptr) (global.get $end))
                (i32.eq (i32.load8_u (global.get $ptr)) (local.get $c)))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if
                  (i32.and
                    (i32.eq (local.get $c) (i32.const "."))
                    (i32.and
                      (i32.lt_u (global.get $ptr) (global.get $end))
                      (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "."))))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $emitTok
                  (select
                    (enum.get $Token.operator)
                    (enum.get $Token.punctuation.delimiter)
                    (i32.eq (local.get $c) (i32.const ".")))
                  (local.get $lhs)
                  (global.get $ptr))
                (local.set $member (i32.const 0)))
              (else
                (call $emitTok
                  (enum.get $Token.punctuation.delimiter)
                  (local.get $lhs)
                  (global.get $ptr))
                (local.set $member (i32.const 1))))
            (local.set $decl (i32.const 0))
            (br $token)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (br $token)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter)
              (local.get $lhs)
              (global.get $ptr))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (br $token)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
        (local.set $decl (i32.const 0))
        (local.set $member (i32.const 0))
        (br $token))))
)
