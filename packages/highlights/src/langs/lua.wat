(module
  (import "../common.wat")

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

  ;; Each value is the word's token; `function` adds 256 to mark that the
  ;; next name is a function definition. A miss is an ordinary name, which
  ;; $hlLua may still promote to a call or a property.
  (keyword-table $luaWords $mem.luaWords $mem.makefileWords
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
    (call $lexEmitLeadingContinuation)
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
