(module
  (import "../common.wat")

  ;; Lowercase words. Bits 8-10 capture the next name: 1 a routine, 2 a package,
  ;; 3 a type, 4 `with`/`use` units. Bit 11 keeps a capture armed (`in out`).
  ;; Bit 12: a tick after the word starts an attribute. `range` collides with
  ;; `raise` and is matched directly.
  (keyword-table $adaWords $mem.adaWords $mem.apexWords
    (group $Token.keyword.control
      "if" "then" "elsif" "else" "case" "when" "loop" "while" "for" "exit" "return" "goto" "raise"
      "select" "accept" "abort" "delay" "terminate" "reverse" "do" "until")
    (group $Token.keyword.declaration+256 "procedure" "function" "entry")
    (group $Token.keyword.declaration+512 "package")
    (group $Token.keyword.declaration+768 "type" "subtype" "task" "protected")
    (group $Token.keyword.import+1024 "with" "use")
    (group $Token.keyword.declaration+2048 "body" "constant" "aliased" "access")
    (group $Token.keyword+2048 "in" "out")
    (group $Token.keyword.operator+2048 "not")
    (group $Token.constant.builtin+2048 "null")
    (group $Token.keyword+6144 "all")
    (group $Token.keyword.declaration
      "declare" "record" "array" "private" "limited" "tagged" "abstract" "interface" "overriding"
      "renames" "generic" "separate" "synchronized" "exception" "pragma")
    (group $Token.keyword "is" "begin" "end" "of" "digits" "delta" "at" "others" "some")
    (group $Token.keyword.operator "and" "or" "xor" "mod" "rem" "abs" "new")
    (group $Token.type.builtin+4096
      "integer" "natural" "positive" "float" "long_float" "long_integer" "boolean" "character"
      "string" "wide_character" "wide_string" "duration")
    (group $Token.boolean+4096 "true" "false"))

  ;; $expect: the pending capture, or 3 after `:`. $prev, for a tick: 0 at a
  ;; clause start, 1 after a name or `)` (attribute), 2 else (character).
  (func $hlAda
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $n i32)
    (local $kind i32)
    (local $hl i32)
    (local $last i32)
    (local $expect i32)
    (local $prev i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (local.set $last (local.get $prev))
        (local.set $prev (i32.const 2))

        (if (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c2) (i32.const "-")))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (local.set $prev (local.get $last))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexRawString (i32.const 34) (i32.const 0) (enum.get $Token.string))
            (local.set $expect (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (if (i32.eq (local.get $last) (i32.const 1))
              (then
                (if (call $lexIsIdentStart (local.get $c2))
                  (then
                    (call $scanIdentRun (i32.const "_"))
                    (local.set $prev (i32.const 1))
                    (local.set $hl (enum.get $Token.attribute)))
                  (else (local.set $hl (enum.get $Token.operator)))))
              (else
                (local.set $p (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 2)) (global.get $end)))
                (local.set $hl (enum.get $Token.none))
                (if
                  (i32.and
                    (i32.eq (call $templateByte (local.get $p)) (i32.const 39))
                    (i32.eqz (byteset.get "\n\r" (local.get $c2))))
                  (then
                    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                    (local.set $hl (enum.get $Token.string))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (call $lexIsDigit (local.get $c))
          (then
            (call $lexScanNumber)
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "#"))
              (then
                (block $basedDone
                  (loop $based
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (local.set $c (call $templateByte (global.get $ptr)))
                    (br_if $based
                      (i32.or
                        (call $lexIsHex (local.get $c))
                        (i32.or (i32.eq (local.get $c) (i32.const "_")) (i32.eq (local.get $c) (i32.const "."))))))
                  (br_if $basedDone (i32.ne (local.get $c) (i32.const "#")))
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (call $lexScanNumberBody (i32.const 0)))))
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $rhs (global.get $ptr))
            (local.set $n
              (call $lexLowerCopy (local.get $lhs) (local.get $rhs) (i32.const $mem.lexLowerScratch)))
            (local.set $kind
              (keyword-table.value $adaWords
                (i32.const $mem.lexLowerScratch)
                (i32.add (i32.const $mem.lexLowerScratch) (local.get $n))))
            (if
              (i32.and
                (i32.eq (local.get $n) (i32.const 5))
                (i32.and
                  (i32.eq (i32.load (i32.const $mem.lexLowerScratch)) (i32.const "rang"))
                  (i32.eq (i32.load8_u (i32.const $mem.lexLowerScratch+4)) (i32.const "e"))))
              (then (local.set $kind (enum.get $Token.keyword))))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (if (i32.eqz (i32.and (local.get $kind) (i32.const 2048)))
                  (then
                    (local.set $expect (i32.and (i32.shr_u (local.get $kind) (i32.const 8)) (i32.const 7)))))
                ;; `with` and `use` open a clause only at its start, not in `new T with record`
                (if (i32.and (i32.eq (local.get $expect) (i32.const 4)) (i32.ne (local.get $last) (i32.const 0)))
                  (then (local.set $expect (i32.const 0))))
                (local.set $prev
                  (select (i32.const 1) (i32.const 2) (i32.and (local.get $kind) (i32.const 4096)))))
              (else
                (local.set $c (call $templateByte (call $lexSkipSpaceAt (local.get $rhs))))
                (local.set $hl
                  (select (enum.get $Token.function) (enum.get $Token.variable) (i32.eq (local.get $c) (i32.const "("))))
                (if (local.get $expect)
                  (then
                    (local.set $hl
                      (select
                        (enum.get $Token.namespace)
                        (select
                          (enum.get $Token.function.definition)
                          (enum.get $Token.type)
                          (i32.eq (local.get $expect) (i32.const 1)))
                        (i32.or
                          (i32.eq (local.get $c) (i32.const "."))
                          (i32.eqz (i32.and (local.get $expect) (i32.const 1))))))
                    (if (i32.and (i32.ne (local.get $c) (i32.const ".")) (i32.ne (local.get $expect) (i32.const 4)))
                      (then (local.set $expect (i32.const 0))))))
                (local.set $prev (i32.const 1))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        (if (i32.and (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c2) (i32.const "<")))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
            (call $scanIdentRun (i32.const "_"))
            (if
              (i32.and
                (i32.gt_u (global.get $ptr) (i32.add (local.get $lhs) (i32.const 2)))
                (i32.and
                  (i32.eq (call $templateByte (global.get $ptr)) (i32.const ">"))
                  (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const ">"))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (call $emitTok (enum.get $Token.label) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (global.set $ptr (local.get $lhs))))

        ;; punctuation ends a capture, except `,` and `.` in a `with` clause or name
        (if (i32.or (i32.ne (local.get $expect) (i32.const 4)) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (if (i32.ne (local.get $c) (i32.const "."))
              (then (local.set $expect (i32.const 0))))))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (local.set $hl (enum.get $Token.none))
        (if (byteset.get "()[]" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (if (i32.or (i32.eq (local.get $c) (i32.const ")")) (i32.eq (local.get $c) (i32.const "]")))
              (then (local.set $prev (i32.const 1))))))
        (if (byteset.get ",.:;" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.punctuation.delimiter))
            (if (i32.eq (local.get $c) (i32.const ";"))
              (then (local.set $prev (i32.const 0))))
            (if
              (i32.or
                (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $c2) (i32.const "=")))
                (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c2) (i32.const "."))))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (local.set $hl (enum.get $Token.operator)))
              (else
                (if (i32.eq (local.get $c) (i32.const ":"))
                  (then (local.set $expect (i32.const 3))))))))
        (if (byteset.get "!%&*+-/<=>|" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.operator))
            (block $opDone
              (loop $op
                (local.set $c (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eqz (byteset.get "!%&*+-/<=>|" (local.get $c))))
                (br_if $opDone
                  (i32.and
                    (i32.eq (local.get $c) (i32.const "-"))
                    (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "-"))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
