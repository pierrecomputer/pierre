(module
  (import "../common.wat")

  ;; Keyword ids double as indices into the packed word and category tables.
  (enum $CWord
    "none"
    "do" "if" "for" "case" "else" "goto" "break" "while"
    "return" "switch" "default" "continue"
    "auto" "extern" "inline" "static" "typedef" "register"
    "int" "bool" "char" "enum" "long" "void" "float" "short" "union"
    "_Bool" "double" "signed" "struct" "unsigned" "_Complex"
    "const" "sizeof" "restrict" "volatile"
    "_Atomic" "_Alignas" "_Alignof" "_Generic"
    "true" "false" "nullptr"
  )

  ;; One byte per $CWord. Six category tests replace the old 44-way token
  ;; ladder. Static C tables occupy the reserved free area starting at
  ;; $mem.cWordBits (see memory.wat).
  (bitset $CWordBits $CWord $mem.cWordBits
    (control
      "do" "if" "for" "case" "else" "goto" "break" "while"
      "return" "switch" "default" "continue"
    )
    (declaration "auto" "extern" "inline" "static" "typedef" "register")
    (builtin
      "int" "bool" "char" "enum" "long" "void" "float" "short" "union"
      "_Bool" "double" "signed" "struct" "unsigned" "_Complex"
    )
    (keyword
      "const" "sizeof" "restrict" "volatile"
      "_Atomic" "_Alignas" "_Alignof" "_Generic"
    )
    (boolean "true" "false")
    (constantBuiltin "nullptr")
  )

  ;; Eight bytes per keyword at $mem.cWords, indexed by $CWord. Short words are
  ;; NUL-padded so a single masked i64 comparison also checks their length.
  (data (i32.const $mem.cWords)
    "\00\00\00\00\00\00\00\00\64\6f\00\00\00\00\00\00\69\66\00\00\00\00\00\00\66\6f\72\00\00\00\00\00\63\61\73\65\00\00\00\00\65\6c\73\65\00\00\00\00\67\6f\74\6f\00\00\00\00\62\72\65\61\6b\00\00\00"
    "\77\68\69\6c\65\00\00\00\72\65\74\75\72\6e\00\00\73\77\69\74\63\68\00\00\64\65\66\61\75\6c\74\00\63\6f\6e\74\69\6e\75\65\61\75\74\6f\00\00\00\00\65\78\74\65\72\6e\00\00\69\6e\6c\69\6e\65\00\00"
    "\73\74\61\74\69\63\00\00\74\79\70\65\64\65\66\00\72\65\67\69\73\74\65\72\69\6e\74\00\00\00\00\00\62\6f\6f\6c\00\00\00\00\63\68\61\72\00\00\00\00\65\6e\75\6d\00\00\00\00\6c\6f\6e\67\00\00\00\00"
    "\76\6f\69\64\00\00\00\00\66\6c\6f\61\74\00\00\00\73\68\6f\72\74\00\00\00\75\6e\69\6f\6e\00\00\00\5f\42\6f\6f\6c\00\00\00\64\6f\75\62\6c\65\00\00\73\69\67\6e\65\64\00\00\73\74\72\75\63\74\00\00"
    "\75\6e\73\69\67\6e\65\64\5f\43\6f\6d\70\6c\65\78\63\6f\6e\73\74\00\00\00\73\69\7a\65\6f\66\00\00\72\65\73\74\72\69\63\74\76\6f\6c\61\74\69\6c\65\5f\41\74\6f\6d\69\63\00\5f\41\6c\69\67\6e\61\73"
    "\5f\41\6c\69\67\6e\6f\66\5f\47\65\6e\65\72\69\63\74\72\75\65\00\00\00\00\66\61\6c\73\65\00\00\00\6e\75\6c\6c\70\74\72\00"
  )

  ;; A 64-slot open-addressed hash at $mem.cHash - the chosen ASCII hash has at
  ;; most one probe for a member; misses are explicitly bounded by the largest
  ;; occupied run (11 slots including its terminating empty slot).
  (data (i32.const $mem.cHash)
    "\00\05\06\00\0b\1e\04\00\00\00\00\12\26\2b\00\1b\0c\1d\08\2c\0d\0f\00\14\00\00\00\23\07\09\00\00"
    "\03\24\0e\16\20\00\00\18\00\19\29\00\1f\28\11\1a\00\10\1c\22\02\17\25\0a\13\15\01\00\27\21\2a\00"
  )

  (func $cWord (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local $hash i32)
    (local $word i32)
    (local $probes i32)
    (local $packed i64)
    (local $mask i64)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.gt_u (i32.sub (local.get $n) (i32.const 2)) (i32.const 6))
      (then (return (enum.get $CWord.none))))
    (if (i32.eq (local.get $n) (i32.const 8))
      (then (local.set $mask (i64.const -1)))
      (else
        (local.set $mask (i64.sub
          (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $n) (i32.const 3))))
          (i64.const 1)))))
    (local.set $packed (i64.and (i64.load (local.get $lhs)) (local.get $mask)))
    (local.set $hash
      (i32.and
        (i32.add
          (i32.add
            (local.get $n)
            (i32.shl (i32.load8_u (local.get $lhs)) (i32.const 1)))
          (i32.add
            (i32.mul (i32.load8_u (i32.sub (local.get $rhs) (i32.const 1))) (i32.const 11))
            (i32.mul (i32.load8_u offset=1 (local.get $lhs)) (i32.const 5))))
        (i32.const 63)))
    (local.set $probes (i32.const 11))
    (loop $probe
      (local.set $word (i32.load8_u (i32.add (i32.const $mem.cHash) (local.get $hash))))
      (if (i32.eqz (local.get $word))
        (then (return (enum.get $CWord.none))))
      (if (i64.eq
            (local.get $packed)
            (i64.load (i32.add (i32.const $mem.cWords) (i32.shl (local.get $word) (i32.const 3)))))
        (then (return (local.get $word))))
      (local.set $hash (i32.and (i32.add (local.get $hash) (i32.const 1)) (i32.const 63)))
      (local.set $probes (i32.sub (local.get $probes) (i32.const 1)))
      (br_if $probe (local.get $probes)))
    (enum.get $CWord.none))

  (func $cWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $p i32)
    (local $word i32)
    (local.set $word (call $cWord (local.get $lhs) (local.get $rhs)))
    (if (bitset.get $CWordBits.control (local.get $word))
      (then (return (enum.get $Token.keyword.control))))
    (if (bitset.get $CWordBits.declaration (local.get $word))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (bitset.get $CWordBits.builtin (local.get $word))
      (then (return (enum.get $Token.type.builtin))))
    (if (bitset.get $CWordBits.keyword (local.get $word))
      (then (return (enum.get $Token.keyword))))
    (if (bitset.get $CWordBits.boolean (local.get $word))
      (then (return (enum.get $Token.boolean))))
    (if (bitset.get $CWordBits.constantBuiltin (local.get $word))
      (then (return (enum.get $Token.constant.builtin))))

    (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
      (then (return (enum.get $Token.constant))))
    (if (i32.and
          (i32.ge_u (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 3))
          (i32.eq (i32.load16_u (i32.sub (local.get $rhs) (i32.const 2))) (i32.const "_t")))
      (then (return (enum.get $Token.type))))
    (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
    (if (i32.and (i32.lt_u (local.get $p) (global.get $end))
                 (i32.eq (i32.load8_u (local.get $p)) (i32.const "(")))
      (then (return (enum.get $Token.function))))
    (if (i32.le_u
          (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25))
      (then (return (enum.get $Token.type))))
    (enum.get $Token.variable))

  (func $cIsOp (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
        (i32.or (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $c) (i32.const "/"))))
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "%")) (i32.eq (local.get $c) (i32.const "=")))
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "!")) (i32.eq (local.get $c) (i32.const "<")))
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const ">")) (i32.eq (local.get $c) (i32.const "&")))
            (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const "^")))
              (i32.or (i32.eq (local.get $c) (i32.const "~")) (i32.eq (local.get $c) (i32.const "?")))))))))

  ;; Extend the shared numeric run for C hexadecimal floats, whose fractional
  ;; part may begin with an a-f digit (`0x1.fp+3`). The run starts at $ptr.
  (func $cScanNumber
    (local $lhs i32)
    (local $next i32)
    (local.set $lhs (global.get $ptr))
    (call $lexScanNumber)
    (if (i32.and
          (i32.lt_u (i32.add (local.get $lhs) (i32.const 1)) (global.get $end))
          (i32.and
            (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "0"))
            (i32.eq (i32.or (i32.load8_u offset=1 (local.get $lhs)) (i32.const 32)) (i32.const "x"))))
      (then
        (if (i32.lt_u (global.get $ptr) (global.get $end))
          (then
            (local.set $next (select
              (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
              (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
            (if (i32.and
                  (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "."))
                  (call $lexIsHex (local.get $next)))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $lexScanNumber))))))))

  (func $hlC
    (local $c i32)
    (local $c2 i32)
    (local $c3 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $hl i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; whitespace gaps
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (select (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
        (local.set $c3 (select (i32.load8_u offset=2 (global.get $ptr)) (i32.const 0)
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))))

        ;; comments
        (if (i32.and (i32.eq (local.get $c) (i32.const "/"))
                     (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2)
              (select (enum.get $Token.comment.doc) (enum.get $Token.comment)
                (i32.or (i32.eq (local.get $c3) (i32.const "/"))
                        (i32.eq (local.get $c3) (i32.const "!")))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/"))
                     (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2)
              (select (enum.get $Token.comment.doc) (enum.get $Token.comment)
                (i32.or (i32.eq (local.get $c3) (i32.const "*"))
                        (i32.eq (local.get $c3) (i32.const "!")))))
            (br $next)))

        ;; A directive occupies its physical line. This also handles # and ##
        ;; inside macro definitions without a second state machine.
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanToLineEnd)
            (if (i32.eqz (call $lexEmitIncludeDirective (local.get $lhs) (global.get $ptr)))
              (then (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))))
            (br $next)))

        ;; strings and character literals
        (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                    (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (br $next)))

        ;; identifiers, including C literal prefixes
        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (if (i32.and
                  (i32.lt_u (global.get $ptr) (global.get $end))
                  (i32.and
                    (i32.or
                      (i32.and
                        (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 1))
                        (i32.or
                          (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "L"))
                          (i32.or
                            (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "u"))
                            (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "U")))))
                      (i32.and
                        (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 2))
                        (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "u8"))))
                    (i32.or
                      (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 34))
                      (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 39)))))
              (then
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (local.get $rhs))
                (call $lexString (i32.load8_u (global.get $ptr))
                  (i32.const 0) (enum.get $Token.string))
                (br $next)))
            (local.set $hl (call $cWordHl (local.get $lhs) (local.get $rhs)))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        ;; numeric preprocessing tokens
        (if (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and (i32.eq (local.get $c) (i32.const "."))
                       (call $lexIsDigit (local.get $c2))))
          (then
            (call $cScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; brackets and delimiters
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const ")")))
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "]")))
                (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
              (i32.or (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $c) (i32.const "."))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; operators: consume at most one compound operator so a following
        ;; slash remains available to open a comment.
        (if (call $cIsOp (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.and (i32.lt_u (global.get $ptr) (global.get $end))
                  (i32.or
                    (i32.eq (local.get $c2) (i32.const "="))
                    (i32.or
                      (i32.and (i32.eq (local.get $c) (local.get $c2))
                        (i32.or
                          (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
                          (i32.or
                            (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const ">")))
                            (i32.or (i32.eq (local.get $c) (i32.const "&")) (i32.eq (local.get $c) (i32.const "|"))))))
                      (i32.and (i32.eq (local.get $c) (i32.const "-"))
                               (i32.eq (local.get $c2) (i32.const ">"))))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.and
                      (i32.lt_u (global.get $ptr) (global.get $end))
                      (i32.and
                        (i32.or (i32.eq (local.get $c) (i32.const "<"))
                                (i32.eq (local.get $c) (i32.const ">")))
                        (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "="))))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; Unknown bytes are plain, but batch a run until the next byte class.
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (block $plainDone
          (loop $plain
            (br_if $plainDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $plainDone (i32.or
              (i32.or
                (i32.or (call $lexIsIdentStart (local.get $c))
                        (call $lexIsDigit (local.get $c)))
                (i32.or (call $cIsOp (local.get $c))
                        (i32.or (i32.eq (local.get $c) (i32.const 34))
                                (i32.eq (local.get $c) (i32.const 39)))))
              (i32.or
                (i32.eq (local.get $c) (i32.const "#"))
                (call $lexIsSpace (local.get $c)))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $plain)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
