(module
  (import "env" "is_id_start"    (func $is_id_start    (param $ptr i32) (param $bits i32) (result i32)))
  (import "env" "is_id_continue" (func $is_id_continue (param $ptr i32) (param $bits i32) (result i32)))

  (import "../token.wat")
  (import "../scan.wat")
  (import "../emit.wat")

  ;; $Lex enum - member order is ABI for the keyword
  ;; hash table below, which stores token ids as raw bytes. NOTE: no parens
  ;; inside the enum form, comments included.
  (enum $Lex
    "eof"
    "invalid"
    ;; operators and punctuation
    "ampersand_ampersand_equal"
    "ampersand_ampersand"
    "ampersand_equal"
    "ampersand"
    "asterisk_asterisk_equal"
    "asterisk_asterisk"
    "asterisk_equal"
    "asterisk"
    "at_identifier"
    "backtick"
    "bang_bang"
    "bang_equal_equal"
    "bang_equal"
    "bang"
    "bigint_literal"
    "caret_equal"
    "caret"
    "colon"
    "comma"
    "comment"
    "dollar_brace"
    "dot"
    "equal_equal_equal"
    "equal_equal"
    "equal"
    "function_arrow"
    "hash_bang"
    "hash_identifier"
    "identifier"
    "l_brace"
    "l_bracket"
    "l_angle_equal"
    "l_angle"
    "l_paren"
    "l_shift_equal"
    "l_shift"
    "minus_equal"
    "minus_minus"
    "minus"
    "multiline_comment"
    "nullish_equal"
    "nullish"
    "number_literal"
    "percent_equal"
    "percent"
    "pipe_equal"
    "pipe_pipe_equal"
    "pipe_pipe"
    "pipe"
    "plus_equal"
    "plus_plus"
    "plus"
    "question_mark_dot"
    "question_mark"
    "r_brace"
    "r_bracket"
    "r_angle_equal"
    "r_angle"
    "r_paren"
    "r_shift_equal"
    "r_shift"
    "r_unsigned_shift_equal"
    "r_unsigned_shift"
    "regexp_literal"
    "semicolon"
    "slash_equal"
    "slash"
    "spread"
    "string_literal"
    "tilde"
    "yield_asterisk"
    ;; keywords and reserved words
    "keyword_break"
    "keyword_case"
    "keyword_catch"
    "keyword_class"
    "keyword_const"
    "keyword_continue"
    "keyword_debugger"
    "keyword_default"
    "keyword_delete"
    "keyword_do"
    "keyword_else"
    "keyword_enum"
    "keyword_export"
    "keyword_extends"
    "keyword_false"
    "keyword_finally"
    "keyword_for"
    "keyword_function"
    "keyword_if"
    "keyword_import"
    "keyword_in"
    "keyword_instanceof"
    "keyword_new"
    "keyword_null"
    "keyword_return"
    "keyword_super"
    "keyword_switch"
    "keyword_this"
    "keyword_throw"
    "keyword_true"
    "keyword_try"
    "keyword_typeof"
    "keyword_var"
    "keyword_void"
    "keyword_while"
    "keyword_with"
    ;; strict mode or ES6
    "keyword_implements"
    "keyword_interface"
    "keyword_let"
    "keyword_package"
    "keyword_private"
    "keyword_protected"
    "keyword_public"
    "keyword_static"
    "keyword_yield"
    ;; contextual identifiers
    "ctxword_as"
    "ctxword_async"
    "ctxword_await"
    "ctxword_from"
    "ctxword_get"
    "ctxword_of"
    "ctxword_set"
    ;; TS
    "ctxword_abstract"
    "ctxword_declare"
    "ctxword_infer"
    "ctxword_is"
    "ctxword_keyof"
    "ctxword_namespace"
    "ctxword_override"
    "ctxword_readonly"
    "ctxword_satisfies"
    "ctxword_type"
  )

  ;; Shared ECMAScript state. Feature bit 0 enables TypeScript and bit 1 JSX.
  (global $ecmaFeatures (mut i32) (i32.const 3))
  (global $sourceStart (mut i32) (i32.const 65536))
  (global $lhs  (mut i32) (i32.const 0))
  (global $rhs  (mut i32) (i32.const 0))
  (global $lto  (mut i32) (i32.const 0))
  (global $prevLto (mut i32) (i32.const 0))
  (global $nlBefore (mut i32) (i32.const 0))
  (global $braceDepth (mut i32) (i32.const 0))
  (global $tmplSp (mut i32) (i32.const 0))
  (global $brkSp (mut i32) (i32.const 0))
  (global $rxCloser (mut i32) (i32.const 0))
  (global $prevTok (mut i32) (i32.const 0)) ;; significant token before the current one
  (global $jsxSp (mut i32) (i32.const 0))   ;; jsx mode stack pointer
  (global $tsxStreaming (mut i32) (i32.const 0))
  (global $tsxStreamMode (mut i32) (i32.const 0))
  (global $tsxStreamNl (mut i32) (i32.const 0))
  (global $tsxStreamExpressionClose (mut i32) (i32.const 0))
  (global $tsxStreamExpressionClosed (mut i32) (i32.const 0))
  (global $tsxStreamExpressionDepth (mut i32) (i32.const 0))

  (func $ecmaHasTypeScript (result i32)
    (i32.ne
      (i32.and (global.get $ecmaFeatures) (i32.const 1))
      (i32.const 0)))

  (func $ecmaHasJsx (result i32)
    (i32.ne
      (i32.and (global.get $ecmaFeatures) (i32.const 2))
      (i32.const 0)))

  ;; bracket-kind stack (regexp-vs-division bookkeeping)
  (func $brkPush (param $k i32)
    (if (i32.lt_u (global.get $brkSp) (i32.const 1024))
      (then (i32.store8 (i32.add (i32.const $mem.tsxBracketStack) (global.get $brkSp)) (local.get $k))))
    (global.set $brkSp (i32.add (global.get $brkSp) (i32.const 1))))
  (func $brkPop
    (global.set $rxCloser (i32.const 0))
    (if (i32.eqz (global.get $brkSp)) (then (return)))
    (global.set $brkSp (i32.sub (global.get $brkSp) (i32.const 1)))
    (if (i32.lt_u (global.get $brkSp) (i32.const 1024))
      (then (global.set $rxCloser (i32.load8_u (i32.add (i32.const $mem.tsxBracketStack) (global.get $brkSp)))))))

  ;; byte at $p, or 0 at/past $end - safe lookahead for multibyte tokens.
  ;; the load itself is always in-bounds (input buffer + 16 bytes of slack).
  (func $tsxByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; byte length of the UTF-8 character starting with $c (0 = invalid lead)
  (func $utf8Bits (param $c i32) (result i32)
    (if (i32.le_u (i32.sub (local.get $c) (i32.const 194)) (i32.const 50))
      (then
        (return (i32.clz (i32.shl (i32.xor (local.get $c) (i32.const -1)) (i32.const 24))))))
    (i32.const 0))


  ;; token-class table at 3328, one byte per $Lex member.
  (bitset $LexBits $Lex $mem.tsxLexBits
    ;; can end an expression: a `/` or `<` after one divides/compares
    (exprEnd
      "identifier" "number_literal" "bigint_literal" "string_literal"
      "regexp_literal" "backtick" "r_paren" "r_bracket" "r_brace"
      "keyword_this" "keyword_true" "keyword_false" "keyword_null"
      "keyword_super" "hash_identifier" "at_identifier"
      "ctxword_as" "ctxword_async" "ctxword_await" "ctxword_from" "ctxword_get"
      "ctxword_of" "ctxword_set" "ctxword_abstract" "ctxword_declare"
      "ctxword_infer" "ctxword_is" "ctxword_keyof" "ctxword_namespace"
      "ctxword_override" "ctxword_readonly" "ctxword_satisfies" "ctxword_type"
    )
    ;; after these a `{` in regexp-allowed position still opens a block
    (braceBlockPrev
      "eof" "semicolon" "l_brace" "r_brace" "r_paren" "function_arrow"
      "keyword_else" "keyword_do" "keyword_try" "keyword_finally"
      "keyword_static"
    )
    ;; control heads: a `/` after the matching `)` starts a regexp
    (tokCtrlParenPrev
      "keyword_if" "keyword_while" "keyword_for" "keyword_with"
    )
    ;; comment tokens: excluded from $lto, skipped for $prevTok
    (comment
      "comment" "multiline_comment" "hash_bang"
    )
    ;; Zed's keyword.control bucket: control flow
    (kwControl
      "keyword_if" "keyword_else" "keyword_switch" "keyword_case"
      "keyword_default" "keyword_for" "keyword_while" "keyword_do"
      "keyword_return" "keyword_try" "keyword_catch" "keyword_finally"
      "keyword_throw" "keyword_break" "keyword_continue" "keyword_yield"
    )
    ;; Zed's keyword.declaration bucket: declaration introducers
    (kwDecl
      "keyword_const" "keyword_let" "keyword_var" "keyword_function"
      "keyword_class" "keyword_enum" "keyword_interface"
    )
  )

  ;; keyword perfect-hash table (displacements, descriptors, word records),
  (data (i32.const $mem.tsxWords)
    "\00\01\05\00\2d\0a\2a\00\12\30\00\09\07\18\27\0c\c6\06\8e\06\97\0c\6a\13\ca\08\12\0a\24\0b\74\09"
    "\38\0c\35\07\30\09\fb\0e\07\08\da\14\83\14\27\10\bf\0c\0d\0d\76\04\57\05\6d\10\9e\0a\00\00\60\13"
    "\e5\12\51\0b\39\05\40\11\00\00\0c\0a\03\13\d5\08\69\06\79\0c\82\11\ef\06\61\0e\1e\10\2a\0b\53\0e"
    "\1b\0b\b0\0a\5a\0b\92\08\79\11\18\0a\42\08\ab\08\a4\0c\49\0f\21\05\bb\06\01\0a\14\0d\80\04\3f\04"
    "\30\0e\cf\0a\f3\0e\4c\0c\47\08\b6\08\3c\07\5b\0a\49\62\72\65\61\6b\4a\63\61\73\65\4b\63\61\74\63"
    "\68\4c\63\6c\61\73\73\4d\63\6f\6e\73\74\4e\63\6f\6e\74\69\6e\75\65\4f\64\65\62\75\67\67\65\72\50"
    "\64\65\66\61\75\6c\74\51\64\65\6c\65\74\65\52\64\6f\53\65\6c\73\65\54\65\6e\75\6d\55\65\78\70\6f"
    "\72\74\56\65\78\74\65\6e\64\73\57\66\61\6c\73\65\58\66\69\6e\61\6c\6c\79\59\66\6f\72\5a\66\75\6e"
    "\63\74\69\6f\6e\5b\69\66\5c\69\6d\70\6f\72\74\5d\69\6e\5e\69\6e\73\74\61\6e\63\65\6f\66\5f\6e\65"
    "\77\60\6e\75\6c\6c\61\72\65\74\75\72\6e\62\73\75\70\65\72\63\73\77\69\74\63\68\64\74\68\69\73\65"
    "\74\68\72\6f\77\66\74\72\75\65\67\74\72\79\68\74\79\70\65\6f\66\69\76\61\72\6a\76\6f\69\64\6b\77"
    "\68\69\6c\65\6c\77\69\74\68\6d\69\6d\70\6c\65\6d\65\6e\74\73\6e\69\6e\74\65\72\66\61\63\65\6f\6c"
    "\65\74\70\70\61\63\6b\61\67\65\71\70\72\69\76\61\74\65\72\70\72\6f\74\65\63\74\65\64\73\70\75\62"
    "\6c\69\63\74\73\74\61\74\69\63\75\79\69\65\6c\64\76\61\73\77\61\73\79\6e\63\78\61\77\61\69\74\79"
    "\66\72\6f\6d\7a\67\65\74\7b\6f\66\7c\73\65\74\7d\61\62\73\74\72\61\63\74\7e\64\65\63\6c\61\72\65"
    "\7f\69\6e\66\65\72\80\69\73\81\6b\65\79\6f\66\82\6e\61\6d\65\73\70\61\63\65\85\73\61\74\69\73\66"
    "\69\65\73\86\74\79\70\65\84\72\65\61\64\6f\6e\6c\79\83\6f\76\65\72\72\69\64\65"
  )

  (func $isKeyword (param $start i32) (param $end i32) (result i32)
    (local $len i32)
    (local $h i32)
    (local $entry i32)
    (local $p i32)
    (local $mask64 i64)
    (local $mask32 i32)
    (local.set $len (i32.sub (local.get $end) (local.get $start)))
    (if (i32.gt_u (i32.sub (local.get $len) (i32.const 2)) (i32.const 8))
      (then (return (enum.get $Lex.invalid))))
    ;; hash the first two bytes, last byte, and length
    (local.set $h
      (i32.or
        (i32.or
          (i32.load16_u (local.get $start))
          (i32.shl
            (i32.load8_u (i32.sub (local.get $end) (i32.const 1)))
            (i32.const 16)))
        (i32.shl (local.get $len) (i32.const 24))))
    (local.set $h
      (i32.mul
        (i32.xor (local.get $h) (i32.shr_u (local.get $h) (i32.const 16)))
        (i32.const 0xe51fac89)))
    (local.set $h
      (i32.xor (local.get $h) (i32.shr_u (local.get $h) (i32.const 24))))
    ;; table+0: displacement; table+16: u16 descriptors
    (local.set $entry
      (i32.load16_u offset=16
        (i32.add (i32.const $mem.tsxWords)
          (i32.shl
            (i32.and
              (i32.add
                (i32.and (i32.shr_u (local.get $h) (i32.const 4)) (i32.const 63))
                (i32.load8_u
                  (i32.add (i32.const $mem.tsxWords)
                    (i32.and (local.get $h) (i32.const 15)))))
              (i32.const 63))
            (i32.const 1)))))
    (if (i32.eqz (local.get $entry))
      (then (return (enum.get $Lex.invalid))))
    (if (i32.ne (local.get $len) (i32.shr_u (local.get $entry) (i32.const 9)))
      (then (return (enum.get $Lex.invalid))))
    ;; records start at table+144: token u8 + exact word; offsets biased by one
    (local.set $p
      (i32.add (i32.const $mem.tsxWords+143)
        (i32.and (local.get $entry) (i32.const 511))))
    (if (i32.le_u (local.get $len) (i32.const 8))
      (then
        (local.set $mask64
          (i64.shr_u (i64.const -1)
            (i64.extend_i32_u
              (i32.shl
                (i32.sub (i32.const 8) (local.get $len))
                (i32.const 3)))))
        (if (i64.ne
              (i64.and (i64.load (local.get $start)) (local.get $mask64))
              (i64.and (i64.load offset=1 (local.get $p)) (local.get $mask64)))
          (then (return (enum.get $Lex.invalid)))))
      (else
        (if (i64.ne
              (i64.load (local.get $start))
              (i64.load offset=1 (local.get $p)))
          (then (return (enum.get $Lex.invalid))))
        (local.set $mask32
          (i32.shr_u (i32.const 65535)
            (i32.shl
              (i32.sub (i32.const 10) (local.get $len))
              (i32.const 3))))
        (if (i32.ne
              (i32.and
                (i32.load16_u offset=8 (local.get $start))
                (local.get $mask32))
              (i32.and
                (i32.load16_u offset=9 (local.get $p))
                (local.get $mask32)))
          (then (return (enum.get $Lex.invalid))))))
    (i32.load8_u (local.get $p)))

  ;; consume identifier-continuation characters from $ptr, 16 bytes per step.
  ;; wide loads may pass $end (the buffer always extends, and the NUL sentinel
  ;; at $eof is never an identifier byte, so the scan terminates); the cursor is
  ;; clamped back to $end before returning.
  (func $scanIdentTail
    (local $c i32)
    (local $bits i32)
    (local $mask i32)
    (local $w v128)
    (local $b v128)
    (local $pass v128)
    (block $done
      (loop $outer
        (block $slow
          (loop $wide
            (local.set $w (v128.load (global.get $ptr)))
            (local.set $b (v128.or (local.get $w) (i8x16.splat (i32.const 32))))
            (local.set $pass
              (v128.or
                (v128.and
                  (i8x16.ge_u (local.get $b) (i8x16.splat (i32.const "a")))
                  (i8x16.le_u (local.get $b) (i8x16.splat (i32.const "z"))))
                (v128.or
                  (v128.and
                    (i8x16.ge_u (local.get $w) (i8x16.splat (i32.const "0")))
                    (i8x16.le_u (local.get $w) (i8x16.splat (i32.const "9"))))
                  (v128.or
                    (i8x16.eq (local.get $w) (i8x16.splat (i32.const "_")))
                    (i8x16.eq (local.get $w) (i8x16.splat (i32.const "$")))))))
            (local.set $mask
              (i32.xor (i8x16.bitmask (local.get $pass)) (i32.const 65535)))
            (if (i32.eqz (local.get $mask))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 16)))
                (br $wide)))
            (global.set $ptr (i32.add (global.get $ptr)
              (i32.ctz (local.get $mask))))
            (br $slow)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        ;; non-ASCII identifier-continuation character?
        (br_if $done (i32.lt_u (local.get $c) (i32.const 128)))
        (local.set $bits (call $utf8Bits (local.get $c)))
        (br_if $done (i32.eqz (local.get $bits)))
        (br_if $done (i32.eqz (call $is_id_continue (global.get $ptr) (local.get $bits))))
        (global.set $ptr (i32.add (global.get $ptr) (local.get $bits)))
        (br $outer)))
    (if (i32.gt_u (global.get $ptr) (global.get $end))
      (then (global.set $ptr (global.get $end)))))

  ;; numeric tail; the first digit or leading dot is already consumed
  (func $scanNumber (param $seenDot i32) (result i32)
    (local $c i32)
    (local $prevC i32)
    (local $hex i32)
    ;; 0x / 0X prefix: `e` is a digit there, never an exponent
    (local.set $hex
      (i32.and
        (i32.eq (i32.load8_u (global.get $lhs)) (i32.const "0"))
        (i32.eq (i32.or (call $tsxByte (i32.add (global.get $lhs) (i32.const 1))) (i32.const 32))
                (i32.const "x"))))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (block $consume
          (br_if $consume (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9)))
          (br_if $consume (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25)))
          (br_if $consume (i32.eq (local.get $c) (i32.const "_")))
          ;; +/- directly after a decimal exponent e/E
          (if (i32.and
                (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
                (i32.and (i32.eqz (local.get $hex))
                         (i32.eq (i32.or (local.get $prevC) (i32.const 32)) (i32.const "e"))))
            (then (br $consume)))
          ;; a single `.`, so `1..toString` lexes as `1.` `.` `toString`
          (if (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.eqz (local.get $seenDot)))
            (then
              (local.set $seenDot (i32.const 1))
              (br $consume)))
          (br $done))
        (local.set $prevC (local.get $c))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l)))
    (enum.get $Lex.number_literal))

  ;; quoted string body; $ptr is just past the opening quote or at the start of
  ;; a resumed chunk. $end-clamped 16-byte scan.
  (func $scanStringBody (param $quote i32) (result i32)
    (local $c i32)
    (block $bail
      (loop $l
        ;; hop to the next quote, backslash, or line break, 16 bytes per step
        (global.set $ptr (call $scanFindSpecial
          (global.get $ptr) (global.get $end) (local.get $quote) (i32.const 1) (i32.const 1)))
        (br_if $bail (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $quote))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (return (enum.get $Lex.string_literal))))
        ;; a raw line break: unterminated, left unconsumed
        (br_if $bail (i32.or (i32.eq (local.get $c) (i32.const 10))
                             (i32.eq (local.get $c) (i32.const 13))))
        ;; backslash escape: two bytes, `\ CR LF` line continuation three
        (if (i32.and (i32.eq (call $tsxByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const 13))
                     (i32.eq (call $tsxByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const 10)))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
        (if (i32.gt_u (global.get $ptr) (global.get $end))
          (then (global.set $ptr (global.get $end))))
        (br $l)))
    (enum.get $Lex.invalid))

  (func $scanString (param $quote i32) (result i32)
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (call $scanStringBody (local.get $quote)))

  ;; template characters; $ptr is just past the opening ` or the resuming }.
  ;; returns backtick for a complete/tail part, dollar_brace when a `${`
  ;; substitution opens, invalid when $end cuts the template short.
  (func $scanTemplateBody (result i32)
    (local $c i32)
    (local $mask i32)
    (local $rem i32)
    (local $w v128)
    (block $bail
      (loop $l
        (br_if $bail (i32.ge_u (global.get $ptr) (global.get $end)))
        ;; hop to the next backtick, `$`, or backslash, 16 bytes per step
        (block $found
          (loop $wide
            (local.set $w (v128.load (global.get $ptr)))
            (local.set $mask (i8x16.bitmask (v128.or
              (v128.or
                (i8x16.eq (local.get $w) (i8x16.splat (i32.const "`")))
                (i8x16.eq (local.get $w) (i8x16.splat (i32.const "$"))))
              (i8x16.eq (local.get $w) (i8x16.splat (i32.const 92))))))
            (local.set $rem (i32.sub (global.get $end) (global.get $ptr)))
            (if (i32.lt_u (local.get $rem) (i32.const 16))
              (then (local.set $mask (i32.and (local.get $mask)
                (i32.sub (i32.shl (i32.const 1) (local.get $rem)) (i32.const 1))))))
            (br_if $found (local.get $mask))
            (if (i32.le_u (local.get $rem) (i32.const 16))
              (then
                (global.set $ptr (global.get $end))
                (br $bail)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 16)))
            (br $wide)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.ctz (local.get $mask))))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const "`"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (return (enum.get $Lex.backtick))))
        (if (i32.and (i32.eq (local.get $c) (i32.const "$"))
                     (i32.eq (call $tsxByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "{")))
          (then
            (if (i32.ge_u (global.get $tmplSp) (i32.const 256))
              (then
                ;; template stack full: treat the `${` as plain characters
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (br $l)))
            (i32.store (i32.add (i32.const $mem.tsxTemplateStack) (i32.shl (global.get $tmplSp) (i32.const 2)))
                       (global.get $braceDepth))
            (global.set $tmplSp (i32.add (global.get $tmplSp) (i32.const 1)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (return (enum.get $Lex.dollar_brace))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (if (i32.gt_u (global.get $ptr) (global.get $end))
              (then (global.set $ptr (global.get $end))))
            (br $l)))
        ;; a bare `$`
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l)))
    (enum.get $Lex.invalid))

  (func $scanRegexp (result i32)
    (local $c i32)
    (local $inClass i32)
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (block $bail
      (block $flags
        (loop $l
          (br_if $bail (i32.ge_u (global.get $ptr) (global.get $end)))
          (local.set $c (i32.load8_u (global.get $ptr)))
          ;; a raw line break: unterminated, left unconsumed
          (br_if $bail (i32.or (i32.eq (local.get $c) (i32.const 10))
                               (i32.eq (local.get $c) (i32.const 13))))
          (if (i32.eq (local.get $c) (i32.const 92))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
              (if (i32.gt_u (global.get $ptr) (global.get $end))
                (then (global.set $ptr (global.get $end))))
              (br $l)))
          (if (i32.le_u (i32.sub (local.get $c) (i32.const "[")) (i32.const 2))
            (then (local.set $inClass (i32.eq (local.get $c) (i32.const "[")))))
          (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eqz (local.get $inClass)))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (br $flags)))
          (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
          (br $l)))
      ;; flags
      (block $fDone
        (loop $f
          (br_if $fDone (i32.ge_u (global.get $ptr) (global.get $end)))
          (br_if $fDone (i32.gt_u
            (i32.sub (i32.or (i32.load8_u (global.get $ptr)) (i32.const 32)) (i32.const "a"))
            (i32.const 25)))
          (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
          (br $f)))
      (return (enum.get $Lex.regexp_literal)))
    (enum.get $Lex.invalid))

  ;; whether `/` after token $t starts a regexp (1) or divides (0)
  (func $rxAllowedAfter (param $t i32) (result i32)
    ;; a `/` on a new line after the module specifier of an import/export
    ;; declaration: the statement is complete, so it starts a regexp
    (if (i32.eq (local.get $t) (enum.get $Lex.string_literal))
      (then (return (i32.and (global.get $nlBefore) (call $afterModuleSpecifier)))))
    ;; `if (a) /re/` is a regexp, `f(a) / 2` a division; `{ } /re/` closes a
    ;; block, `x = {} / 2` an object - the bracket-kind stack recorded which
    (if (i32.eq (local.get $t) (enum.get $Lex.r_paren)) (then (return (global.get $rxCloser))))
    (if (i32.eq (local.get $t) (enum.get $Lex.r_brace)) (then (return (global.get $rxCloser))))
    ;; contextual keywords are plain identifiers, except the two operators
    (if (i32.and (i32.ge_u (local.get $t) (enum.get $Lex.ctxword_as))
                 (i32.le_u (local.get $t) (enum.get $Lex.ctxword_type)))
      (then (return (i32.or (i32.eq (local.get $t) (enum.get $Lex.ctxword_await))
                            (i32.eq (local.get $t) (enum.get $Lex.ctxword_of))))))
    (if (i32.eq (local.get $t) (enum.get $Lex.at_identifier))
      (then (return (i32.const 1))))
    (if (bitset.get $LexBits.exprEnd (local.get $t))
      (then (return (i32.const 0))))
    (if (i32.or (i32.eq (local.get $t) (enum.get $Lex.plus_plus))
                (i32.eq (local.get $t) (enum.get $Lex.minus_minus)))
      (then (return (i32.const 0))))
    (i32.const 1))

  (func $regexpAllowed (result i32)
    (call $rxAllowedAfter (global.get $lto)))

  ;; can a `<` after token $t open a JSX element? same operand-position logic
  ;; as the regexp choice, minus the module-specifier corner
  (func $jsxCanStart (param $t i32) (result i32)
    (if (i32.eq (local.get $t) (enum.get $Lex.string_literal))
      (then (return (i32.const 0))))
    (call $rxAllowedAfter (local.get $t)))

  ;; is the string literal in $lto the module specifier of an import/export?
  (func $afterModuleSpecifier (result i32)
    (local $t i32)
    (local.set $t (global.get $prevLto))
    (i32.or
      (i32.eq (local.get $t) (enum.get $Lex.ctxword_from))
      (i32.or (i32.eq (local.get $t) (enum.get $Lex.keyword_import))
              (i32.eq (local.get $t) (enum.get $Lex.keyword_export)))))

  ;; `(` right after if/while/for/with opens a control-flow head
  (func $parenIsCtrl (result i32)
    (i32.ne (bitset.get $LexBits.tokCtrlParenPrev (global.get $lto)) (i32.const 0)))

  ;; does the `{` about to be scanned open a block (1) or an object (0)?
  (func $braceIsBlock (result i32)
    (if (i32.eqz (call $regexpAllowed)) (then (return (i32.const 1))))
    (i32.ne (bitset.get $LexBits.braceBlockPrev (global.get $lto)) (i32.const 0)))

  (func $scanToken (result i32)
    (local $c i32)
    (local $c2 i32)
    (local $bits i32)
    (local $kw i32)
    (local $take i32)
    (global.set $nlBefore (i32.const 0))
    (if (global.get $tsxStreaming)
      (then
        (global.set $nlBefore (global.get $tsxStreamNl))
        (global.set $tsxStreamNl (i32.const 0))))
    ;; skip whitespace (ASCII + NBSP, LS, PS, BOM), bounded by $end
    (block $wsDone
      (loop $ws
        (br_if $wsDone (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        ;; fast path: printable ASCII except space is never whitespace
        (br_if $wsDone (i32.le_u (i32.sub (local.get $c) (i32.const 33)) (i32.const 93)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 32))
                    (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4)))
          (then
            (if (i32.or (i32.eq (local.get $c) (i32.const 10))
                        (i32.eq (local.get $c) (i32.const 13)))
              (then (global.set $nlBefore (i32.const 1))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            ;; indentation: skip 8 spaces at a time, clamped to $end
            (block $wideDone
              (loop $wide
                (br_if $wideDone (i32.gt_u (i32.add (global.get $ptr) (i32.const 8)) (global.get $end)))
                (br_if $wideDone (i64.ne (i64.load (global.get $ptr)) (i64.const 0x2020202020202020)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 8)))
                (br $wide)))
            (br $ws)))
        ;; U+00A0 no-break space
        (if (i32.and (i32.eq (local.get $c) (i32.const 194))
                     (i32.eq (call $tsxByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const 160)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (br $ws)))
        ;; U+2028 / U+2029 line separators
        (if (i32.and
              (i32.eq (i32.and (i32.load (global.get $ptr)) (i32.const 0x00feffff)) (i32.const 0x00a880e2))
              (i32.le_u (i32.add (global.get $ptr) (i32.const 3)) (global.get $end)))
          (then
            (global.set $nlBefore (i32.const 1))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
            (br $ws)))
        ;; U+FEFF byte order mark
        (if (i32.and
              (i32.eq (i32.and (i32.load (global.get $ptr)) (i32.const 0x00ffffff)) (i32.const 0x00bfbbef))
              (i32.le_u (i32.add (global.get $ptr) (i32.const 3)) (global.get $end)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
            (br $ws)))))
    (global.set $lhs (global.get $ptr))
    (if (i32.ge_u (global.get $ptr) (global.get $end))
      (then
        (if (global.get $tsxStreaming)
          (then (global.set $tsxStreamNl (global.get $nlBefore))))
        (return (enum.get $Lex.eof))))
    (local.set $c (i32.load8_u (global.get $ptr)))

    ;; identifier / keyword
    (if (i32.or
          (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
          (i32.or (i32.eq (local.get $c) (i32.const "_")) (i32.eq (local.get $c) (i32.const "$"))))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $scanIdentTail)
        ;; after `.` / `?.` an IdentifierName is never a keyword
        (if (i32.or (i32.eq (global.get $lto) (enum.get $Lex.dot))
                    (i32.eq (global.get $lto) (enum.get $Lex.question_mark_dot)))
          (then (return (enum.get $Lex.identifier))))
        (if (i32.eq (local.tee $kw (call $isKeyword (global.get $lhs) (global.get $ptr)))
                    (enum.get $Lex.invalid))
          (then (return (enum.get $Lex.identifier))))
        (if (i32.and
              (i32.eqz (call $ecmaHasTypeScript))
              (i32.ge_u (local.get $kw) (enum.get $Lex.ctxword_abstract)))
          (then (return (enum.get $Lex.identifier))))
        (return (local.get $kw))))

    ;; number
    (if (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (return (call $scanNumber (i32.const 0)))))

    (local.set $c2 (call $tsxByte (i32.add (global.get $ptr) (i32.const 1))))

    ;; punctuation leaves through one common epilogue: the branch result packs
    ;; token kind above the low three-bit byte length
    (block $takeDone (result i32)
      (if (i32.eq (local.get $c) (i32.const "("))
        (then
          (call $brkPush (call $parenIsCtrl))
          (br $takeDone (i32.or (i32.shl (enum.get $Lex.l_paren) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const ")"))
        (then
          (call $brkPop)
          (br $takeDone (i32.or (i32.shl (enum.get $Lex.r_paren) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const "."))
        (then
          (if (i32.and (i32.eq (local.get $c2) (i32.const "."))
                       (i32.eq (call $tsxByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const ".")))
            (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.spread) (i32.const 3)) (i32.const 3)))))
          (if (i32.le_u (i32.sub (local.get $c2) (i32.const "0")) (i32.const 9))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (return (call $scanNumber (i32.const 1)))))
          (br $takeDone (i32.or (i32.shl (enum.get $Lex.dot) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const ";")) (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.semicolon) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const ",")) (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.comma) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const ":")) (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.colon) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const "{"))
        (then
          (call $brkPush (call $braceIsBlock))
          (global.set $braceDepth (i32.add (global.get $braceDepth) (i32.const 1)))
          (br $takeDone (i32.or (i32.shl (enum.get $Lex.l_brace) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const "}"))
        (then
          ;; does this `}` resume a template literal?
          (if (i32.and (i32.gt_u (global.get $tmplSp) (i32.const 0))
                (i32.eq (global.get $braceDepth)
                        (i32.load (i32.add (i32.const $mem.tsxTemplateStack)
                          (i32.shl (i32.sub (global.get $tmplSp) (i32.const 1)) (i32.const 2))))))
            (then
              (global.set $tmplSp (i32.sub (global.get $tmplSp) (i32.const 1)))
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (return (call $scanTemplateBody))))
          (call $brkPop)
          (global.set $braceDepth (i32.sub (global.get $braceDepth) (i32.const 1)))
          (br $takeDone (i32.or (i32.shl (enum.get $Lex.r_brace) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const "="))
        (then
          (if (i32.eq (local.get $c2) (i32.const "="))
            (then
              (if (i32.eq (call $tsxByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const "="))
                (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.equal_equal_equal) (i32.const 3)) (i32.const 3)))))
              (br $takeDone (i32.or (i32.shl (enum.get $Lex.equal_equal) (i32.const 3)) (i32.const 2)))))
          (if (i32.eq (local.get $c2) (i32.const ">"))
            (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.function_arrow) (i32.const 3)) (i32.const 2)))))
          (br $takeDone (i32.or (i32.shl (enum.get $Lex.equal) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const "/"))
        (then
          (if (i32.eq (local.get $c2) (i32.const "/"))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
              (call $scanToLineEnd)
              (return (enum.get $Lex.comment))))
          (if (i32.eq (local.get $c2) (i32.const "*"))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
              (call $scanBlockCommentEnd)
              (return (enum.get $Lex.multiline_comment))))
          (if (call $regexpAllowed)
            (then (return (call $scanRegexp))))
          (if (i32.eq (local.get $c2) (i32.const "="))
            (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.slash_equal) (i32.const 3)) (i32.const 2)))))
          (br $takeDone (i32.or (i32.shl (enum.get $Lex.slash) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const "&"))
        (then
          (if (i32.eq (local.get $c2) (i32.const "&"))
            (then
              (if (i32.eq (call $tsxByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const "="))
                (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.ampersand_ampersand_equal) (i32.const 3)) (i32.const 3)))))
              (br $takeDone (i32.or (i32.shl (enum.get $Lex.ampersand_ampersand) (i32.const 3)) (i32.const 2)))))
          (if (i32.eq (local.get $c2) (i32.const "="))
            (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.ampersand_equal) (i32.const 3)) (i32.const 2)))))
          (br $takeDone (i32.or (i32.shl (enum.get $Lex.ampersand) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const "!"))
        (then
          (if (i32.eq (local.get $c2) (i32.const "="))
            (then
              (if (i32.eq (call $tsxByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const "="))
                (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.bang_equal_equal) (i32.const 3)) (i32.const 3)))))
              (br $takeDone (i32.or (i32.shl (enum.get $Lex.bang_equal) (i32.const 3)) (i32.const 2)))))
          (br $takeDone (i32.or (i32.shl (enum.get $Lex.bang) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const "|"))
        (then
          (if (i32.eq (local.get $c2) (i32.const "|"))
            (then
              (if (i32.eq (call $tsxByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const "="))
                (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.pipe_pipe_equal) (i32.const 3)) (i32.const 3)))))
              (br $takeDone (i32.or (i32.shl (enum.get $Lex.pipe_pipe) (i32.const 3)) (i32.const 2)))))
          (if (i32.eq (local.get $c2) (i32.const "="))
            (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.pipe_equal) (i32.const 3)) (i32.const 2)))))
          (br $takeDone (i32.or (i32.shl (enum.get $Lex.pipe) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const "?"))
        (then
          (if (i32.eq (local.get $c2) (i32.const "."))
            (then
              ;; `?.3` is ternary + number, not optional chaining
              (if (i32.le_u (i32.sub (call $tsxByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const "0")) (i32.const 9))
                (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.question_mark) (i32.const 3)) (i32.const 1)))))
              (br $takeDone (i32.or (i32.shl (enum.get $Lex.question_mark_dot) (i32.const 3)) (i32.const 2)))))
          (if (i32.eq (local.get $c2) (i32.const "?"))
            (then
              (if (i32.eq (call $tsxByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const "="))
                (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.nullish_equal) (i32.const 3)) (i32.const 3)))))
              (br $takeDone (i32.or (i32.shl (enum.get $Lex.nullish) (i32.const 3)) (i32.const 2)))))
          (br $takeDone (i32.or (i32.shl (enum.get $Lex.question_mark) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const "["))
        (then
          (call $brkPush (i32.const 0))
          (br $takeDone (i32.or (i32.shl (enum.get $Lex.l_bracket) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const "]"))
        (then
          (call $brkPop)
          (br $takeDone (i32.or (i32.shl (enum.get $Lex.r_bracket) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const 34))
        (then (return (call $scanString (i32.const 34)))))
      (if (i32.eq (local.get $c) (i32.const 39))
        (then (return (call $scanString (i32.const 39)))))
      (if (i32.eq (local.get $c) (i32.const "<"))
        (then
          (if (i32.eq (local.get $c2) (i32.const "<"))
            (then
              (if (i32.eq (call $tsxByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const "="))
                (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.l_shift_equal) (i32.const 3)) (i32.const 3)))))
              (br $takeDone (i32.or (i32.shl (enum.get $Lex.l_shift) (i32.const 3)) (i32.const 2)))))
          (if (i32.eq (local.get $c2) (i32.const "="))
            (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.l_angle_equal) (i32.const 3)) (i32.const 2)))))
          (br $takeDone (i32.or (i32.shl (enum.get $Lex.l_angle) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const ">"))
        (then
          (if (i32.eq (local.get $c2) (i32.const ">"))
            (then
              (if (i32.eq (call $tsxByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const ">"))
                (then
                  (if (i32.eq (call $tsxByte (i32.add (global.get $ptr) (i32.const 3))) (i32.const "="))
                    (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.r_unsigned_shift_equal) (i32.const 3)) (i32.const 4)))))
                  (br $takeDone (i32.or (i32.shl (enum.get $Lex.r_unsigned_shift) (i32.const 3)) (i32.const 3)))))
              (if (i32.eq (call $tsxByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const "="))
                (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.r_shift_equal) (i32.const 3)) (i32.const 3)))))
              (br $takeDone (i32.or (i32.shl (enum.get $Lex.r_shift) (i32.const 3)) (i32.const 2)))))
          (if (i32.eq (local.get $c2) (i32.const "="))
            (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.r_angle_equal) (i32.const 3)) (i32.const 2)))))
          (br $takeDone (i32.or (i32.shl (enum.get $Lex.r_angle) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const "+"))
        (then
          (if (i32.eq (local.get $c2) (i32.const "+"))
            (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.plus_plus) (i32.const 3)) (i32.const 2)))))
          (if (i32.eq (local.get $c2) (i32.const "="))
            (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.plus_equal) (i32.const 3)) (i32.const 2)))))
          (br $takeDone (i32.or (i32.shl (enum.get $Lex.plus) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const "-"))
        (then
          (if (i32.eq (local.get $c2) (i32.const "-"))
            (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.minus_minus) (i32.const 3)) (i32.const 2)))))
          (if (i32.eq (local.get $c2) (i32.const "="))
            (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.minus_equal) (i32.const 3)) (i32.const 2)))))
          (br $takeDone (i32.or (i32.shl (enum.get $Lex.minus) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const "*"))
        (then
          (if (i32.eq (local.get $c2) (i32.const "*"))
            (then
              (if (i32.eq (call $tsxByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const "="))
                (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.asterisk_asterisk_equal) (i32.const 3)) (i32.const 3)))))
              (br $takeDone (i32.or (i32.shl (enum.get $Lex.asterisk_asterisk) (i32.const 3)) (i32.const 2)))))
          (if (i32.eq (local.get $c2) (i32.const "="))
            (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.asterisk_equal) (i32.const 3)) (i32.const 2)))))
          (br $takeDone (i32.or (i32.shl (enum.get $Lex.asterisk) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const "%"))
        (then
          (if (i32.eq (local.get $c2) (i32.const "="))
            (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.percent_equal) (i32.const 3)) (i32.const 2)))))
          (br $takeDone (i32.or (i32.shl (enum.get $Lex.percent) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const "^"))
        (then
          (if (i32.eq (local.get $c2) (i32.const "="))
            (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.caret_equal) (i32.const 3)) (i32.const 2)))))
          (br $takeDone (i32.or (i32.shl (enum.get $Lex.caret) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const "~"))
        (then (br $takeDone (i32.or (i32.shl (enum.get $Lex.tilde) (i32.const 3)) (i32.const 1)))))
      (if (i32.eq (local.get $c) (i32.const "`"))
        (then
          (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
          (return (call $scanTemplateBody))))
      (if (i32.eq (local.get $c) (i32.const "@"))
        (then
          (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
          (call $scanIdentTail)
          (return (enum.get $Lex.at_identifier))))
      (if (i32.eq (local.get $c) (i32.const "#"))
        (then
          ;; #! shebang, only at the very beginning of the scan
          (if (i32.and (i32.eq (global.get $ptr) (global.get $sourceStart))
                       (i32.eq (local.get $c2) (i32.const "!")))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
              (call $scanToLineEnd)
              (return (enum.get $Lex.hash_bang))))
          (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
          (call $scanIdentTail)
          (return (enum.get $Lex.hash_identifier))))
      ;; non-ASCII identifier start
      (if (i32.ge_u (local.get $c) (i32.const 128))
        (then
          (local.set $bits (call $utf8Bits (local.get $c)))
          (if (i32.and (i32.ne (local.get $bits) (i32.const 0))
                       (call $is_id_start (global.get $ptr) (local.get $bits)))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (local.get $bits)))
              (call $scanIdentTail)
              (return (enum.get $Lex.identifier))))
          ;; unrecognized: consume the whole (possibly multibyte) character so the
          ;; scan always advances and never splits a code point across tokens
          (global.set $ptr (i32.add (global.get $ptr)
            (select (local.get $bits) (i32.const 1) (local.get $bits))))
          (if (i32.gt_u (global.get $ptr) (global.get $end))
            (then (global.set $ptr (global.get $end))))
          (return (enum.get $Lex.invalid))))
      ;; unrecognized ASCII byte: consume it
      (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
      (return (enum.get $Lex.invalid)))
    (local.set $take)
    (global.set $ptr (i32.add (global.get $ptr) (i32.and (local.get $take) (i32.const 7))))
    (i32.shr_u (local.get $take) (i32.const 3)))

  ;; read the next token; its byte range is [$lhs, $rhs). comments do not
  ;; update $lto so the regexp/division decision sees through them.
  (func $nextToken (result i32)
    (local $t i32)
    (local.set $t (call $scanToken))
    (global.set $rhs (global.get $ptr))
    (if (i32.and
          (global.get $tsxStreaming)
          (i32.eq (global.get $ptr) (global.get $end)))
      (then
        (if (i32.eq (local.get $t) (enum.get $Lex.invalid))
          (then
            (if (i32.eq (i32.load8_u (global.get $lhs)) (i32.const "`"))
              (then (global.set $tsxStreamMode (i32.const 1))))
            (if (i32.eq (i32.load8_u (global.get $lhs)) (i32.const "}"))
              (then (global.set $tsxStreamMode (i32.const 1))))
            (if (i32.eq (i32.load8_u (global.get $lhs)) (i32.const 34))
              (then (global.set $tsxStreamMode (i32.const 4))))
            (if (i32.eq (i32.load8_u (global.get $lhs)) (i32.const 39))
              (then (global.set $tsxStreamMode (i32.const 5))))))
        (if (i32.and
              (i32.eq (local.get $t) (enum.get $Lex.multiline_comment))
              (i32.or
                (i32.lt_u (i32.sub (global.get $rhs) (global.get $lhs)) (i32.const 2))
                (i32.ne
                  (i32.load16_u (i32.sub (global.get $rhs) (i32.const 2)))
                  (i32.const 0x2f2a))))
          (then
            (global.set $tsxStreamMode
              (select
                (i32.const 3)
                (i32.const 2)
                (i32.and
                  (i32.gt_u (i32.sub (global.get $rhs) (global.get $lhs)) (i32.const 3))
                  (i32.eq (i32.load8_u offset=2 (global.get $lhs)) (i32.const "*")))))))))
    (if (i32.and
          (i32.eqz (bitset.get $LexBits.comment (local.get $t)))
          (i32.and
            (i32.ne (local.get $t) (enum.get $Lex.eof))
            (i32.eqz (global.get $tsxStreamMode))))
      (then
        (global.set $prevLto (global.get $lto))
        (global.set $lto (local.get $t))))
    (local.get $t))

  ;; Return the byte after the `}` balancing the `{` at $from. This reuses the
  ;; real token scanner, then restores $ptr; unterminated expressions reach
  ;; $end. $body may start after a Svelte block/directive marker.
  ;; INVARIANT: when $from < $end the result is strictly greater than $from -
  ;; the vue/svelte/astro main loops rely on this to always advance.
  (func $tsxExpressionEnd (param $from i32) (param $body i32) (result i32)
    (local $save i32)
    (local $to i32)
    (local $t i32)
    (if (i32.or
          (i32.ge_u (local.get $from) (global.get $end))
          (i32.ge_u (local.get $body) (global.get $end)))
      (then (return (global.get $end))))
    (local.set $save (global.get $ptr))
    (global.set $ptr (local.get $body))
    (global.set $sourceStart (local.get $body))
    (global.set $lto (enum.get $Lex.eof))
    (global.set $prevLto (enum.get $Lex.eof))
    (global.set $prevTok (enum.get $Lex.eof))
    (global.set $nlBefore (i32.const 0))
    (global.set $braceDepth (i32.const 0))
    (global.set $tmplSp (i32.const 0))
    (global.set $brkSp (i32.const 0))
    (global.set $rxCloser (i32.const 0))
    (global.set $jsxSp (i32.const 0))
    (if (i32.eq (local.get $body) (local.get $from))
      (then (local.set $t (call $nextToken)))
      (else
        (call $brkPush (i32.const 1))
        (global.set $braceDepth (i32.const 1))))
    (if (i32.and
          (i32.eq (local.get $body) (local.get $from))
          (i32.ne (local.get $t) (enum.get $Lex.l_brace)))
      (then (local.set $to (i32.add (local.get $from) (i32.const 1))))
      (else
        (block $done
          (loop $token
            (local.set $t (call $nextToken))
            (if (i32.eq (local.get $t) (enum.get $Lex.eof))
              (then
                (local.set $to (global.get $end))
                (br $done)))
            (if (i32.and
                  (i32.eq (local.get $t) (enum.get $Lex.r_brace))
                  (i32.eqz (global.get $braceDepth)))
              (then
                (local.set $to (global.get $rhs))
                (br $done)))
            (br $token)))))
    (global.set $ptr (local.get $save))
    (local.get $to))

  ;; emit [$from,$to) as $hl with string.escape sub-spans for `\x` escapes.
  ;; escape spans cover only what is actually present - `\u` / `\x` plus the
  ;; hex digits found (and the braces of a `\u{...}` code-point escape) - so a
  ;; short escape never swallows the following byte. An escaped multibyte
  ;; UTF-8 character stays whole inside the escape span - a span boundary must
  ;; never split a code point.
  (func $emitEscaped (param $hl i32) (param $from i32) (param $to i32)
    (local $seg i32)
    (local $e i32)
    (local $c i32)
    (local.set $seg (local.get $from))
    (block $done
      (loop $l
        ;; hop to the next backslash, 16 bytes per step
        (local.set $from (call $scanFindSpecial
          (local.get $from) (local.get $to) (i32.const 92) (i32.const 0) (i32.const 0)))
        (br_if $done (i32.ge_u (local.get $from) (local.get $to)))
        (call $emitTok (local.get $hl) (local.get $seg) (local.get $from))
        (local.set $c (call $tsxByte (i32.add (local.get $from) (i32.const 1))))
        (if (i32.eq (local.get $c) (i32.const "u"))
          (then
            (if (i32.eq (call $tsxByte (i32.add (local.get $from) (i32.const 2))) (i32.const "{"))
              ;; `\u{...}`: the hex run (leading zeros allowed) + closing brace
              (then
                (local.set $e (call $scanHexRun
                  (i32.add (local.get $from) (i32.const 3)) (i32.const 16)))
                (if (i32.and (i32.lt_u (local.get $e) (local.get $to))
                             (i32.eq (i32.load8_u (local.get $e)) (i32.const "}")))
                  (then (local.set $e (i32.add (local.get $e) (i32.const 1))))))
              (else (local.set $e (call $scanHexRun
                (i32.add (local.get $from) (i32.const 2)) (i32.const 4))))))
          (else
            (if (i32.eq (local.get $c) (i32.const "x"))
              (then (local.set $e (call $scanHexRun
                (i32.add (local.get $from) (i32.const 2)) (i32.const 2))))
              (else (local.set $e (i32.add (local.get $from) (i32.const 2)))))))
        (local.set $e (call $utf8SpanEnd (local.get $e) (local.get $to)))
        (call $emitTok (enum.get $Token.string.escape) (local.get $from) (local.get $e))
        (local.set $from (local.get $e))
        (local.set $seg (local.get $e))
        (br $l)))
    (call $emitTok (local.get $hl) (local.get $seg) (local.get $to)))

  ;; emit a template token: a leading `}` (resume) and a trailing `${` are
  ;; punctuation.special, the rest is string with escape sub-spans
  (func $emitTemplate (param $lhs i32) (param $rhs i32) (param $dollarBrace i32)
    (local $p i32)
    (local $e i32)
    (local.set $p (local.get $lhs))
    (if (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "}"))
      (then
        (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (local.get $p))))
    (local.set $e (local.get $rhs))
    (if (local.get $dollarBrace)
      (then
        (local.set $e (i32.sub (local.get $rhs) (i32.const 2)))
        (if (i32.lt_u (local.get $e) (local.get $p))
          (then (local.set $e (local.get $p))))))
    (call $emitEscaped (enum.get $Token.string) (local.get $p) (local.get $e))
    (call $emitTok (enum.get $Token.punctuation.special) (local.get $e) (local.get $rhs)))

  ;; the JSDoc tag word [$lhs,$rhs) - without the `@` - takes a name argument
  ;; (`@param {t} name`). words longer than 8 bytes match nothing; shorter
  ;; ones are masked to their length, so equality implies exact length too
  (func $isParamTag (param $lhs i32) (param $rhs i32) (result i32)
    (local $len i32)
    (local $w i64)
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.gt_u (local.get $len) (i32.const 8)) (then (return (i32.const 0))))
    (local.set $w (i64.load (local.get $lhs)))
    (if (i32.lt_u (local.get $len) (i32.const 8))
      (then (local.set $w (i64.and (local.get $w)
        (i64.sub
          (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $len) (i32.const 3))))
          (i64.const 1))))))
    (i32.or
      (i32.or
        (i32.or (i64.eq (local.get $w) (i64.const "param"))
                (i64.eq (local.get $w) (i64.const "arg")))
        (i32.or (i64.eq (local.get $w) (i64.const "argument"))
                (i64.eq (local.get $w) (i64.const "prop"))))
      (i32.or
        (i32.or (i64.eq (local.get $w) (i64.const "property"))
                (i64.eq (local.get $w) (i64.const "template")))
        (i32.or (i64.eq (local.get $w) (i64.const "typedef"))
                (i64.eq (local.get $w) (i64.const "callback"))))))

  ;; a JSDoc parameter path byte: identifier characters plus `.` for `opts.count`
  (func $docNameChar (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
        (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9)))
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "_"))
                (i32.eq (local.get $c) (i32.const "$")))
        (i32.eq (local.get $c) (i32.const ".")))))

  ;; emit a `/** ... */` doc comment with JSDoc tags highlighted (Zed's JSDoc
  ;; captures): `@tag` is keyword.jsdoc; a `{...}` brace group right after it
  ;; - same line, balanced - is a type.jsdoc in punctuation.bracket braces;
  ;; after the param-like tags the next identifier path is variable.jsdoc.
  ;; Everything else, including every malformed shape, stays comment.doc. The
  ;; token [$lhs,$rhs) is already clamped, so scans bound on $rhs, not $end;
  ;; wide loads may read past $rhs into the buffer slack, and any `@` found
  ;; at or past $rhs is masked off
  (func $emitDocCommentRange (param $lhs i32) (param $rhs i32) (param $skip i32)
    (local $seg i32)   ;; start of the pending comment.doc run
    (local $p i32)     ;; scan cursor
    (local $e i32)     ;; tag end
    (local $q i32)     ;; whitespace lookahead
    (local $b i32)     ;; brace / name scan cursor
    (local $c i32)
    (local $mask i32)
    (local $rem i32)
    (local $depth i32)
    (local $isParam i32)
    (local.set $seg (local.get $lhs))
    (local.set $p (i32.add (local.get $lhs) (local.get $skip)))
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (local.get $p) (local.get $rhs)))
        ;; find the next `@` - 16 bytes per step
        (local.set $mask (i8x16.bitmask (i8x16.eq
          (v128.load (local.get $p)) (i8x16.splat (i32.const "@")))))
        (local.set $rem (i32.sub (local.get $rhs) (local.get $p)))
        (if (i32.lt_u (local.get $rem) (i32.const 16))
          (then (local.set $mask (i32.and (local.get $mask)
            (i32.sub (i32.shl (i32.const 1) (local.get $rem)) (i32.const 1))))))
        (if (i32.eqz (local.get $mask))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 16)))
            (br $scan)))
        (local.set $p (i32.add (local.get $p) (i32.ctz (local.get $mask))))
        ;; a tag needs start-of-word context - whitespace, `*`, `{`, `(` -
        ;; so `user@host` in prose stays plain
        (local.set $c (i32.const 32))
        (if (i32.gt_u (local.get $p) (local.get $lhs))
          (then (local.set $c (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))))
        (if (i32.eqz (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const 32))
                      (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4)))
              (i32.or (i32.eq (local.get $c) (i32.const "*"))
                      (i32.or (i32.eq (local.get $c) (i32.const "{"))
                              (i32.eq (local.get $c) (i32.const "("))))))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $scan)))
        ;; ... and a letter after the `@`
        (local.set $e (i32.add (local.get $p) (i32.const 1)))
        (if (i32.ge_u (local.get $e) (local.get $rhs))
          (then
            (local.set $p (local.get $e))
            (br $scan)))
        (if (i32.gt_u
              (i32.sub (i32.or (i32.load8_u (local.get $e)) (i32.const 32)) (i32.const "a"))
              (i32.const 25))
          (then
            (local.set $p (local.get $e))
            (br $scan)))
        ;; tag body: letters and digits
        (block $tagEnd
          (loop $tag
            (local.set $e (i32.add (local.get $e) (i32.const 1)))
            (br_if $tagEnd (i32.ge_u (local.get $e) (local.get $rhs)))
            (local.set $c (i32.load8_u (local.get $e)))
            (br_if $tag (i32.le_u
              (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25)))
            (br_if $tag (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9)))))
        (call $emitTok (enum.get $Token.comment.doc) (local.get $seg) (local.get $p))
        (call $emitTok (enum.get $Token.keyword.jsdoc) (local.get $p) (local.get $e))
        (local.set $isParam
          (call $isParamTag (i32.add (local.get $p) (i32.const 1)) (local.get $e)))
        (local.set $seg (local.get $e))
        (local.set $p (local.get $e))
        ;; optional `{type}` after the tag
        (block $noType
          (local.set $q (local.get $p))
          (loop $sp
            (br_if $noType (i32.ge_u (local.get $q) (local.get $rhs)))
            (local.set $c (i32.load8_u (local.get $q)))
            (if (i32.or (i32.eq (local.get $c) (i32.const 32))
                        (i32.eq (local.get $c) (i32.const 9)))
              (then
                (local.set $q (i32.add (local.get $q) (i32.const 1)))
                (br $sp))))
          (br_if $noType (i32.ne (local.get $c) (i32.const "{")))
          ;; scan to the balanced `}` - an unclosed group, or one running
          ;; past the line, stays plain
          (local.set $b (i32.add (local.get $q) (i32.const 1)))
          (local.set $depth (i32.const 1))
          (loop $brace
            (br_if $noType (i32.ge_u (local.get $b) (local.get $rhs)))
            (local.set $c (i32.load8_u (local.get $b)))
            (br_if $noType (i32.or (i32.eq (local.get $c) (i32.const 10))
                                   (i32.eq (local.get $c) (i32.const 13))))
            (if (i32.eq (local.get $c) (i32.const "{"))
              (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
            (if (i32.eq (local.get $c) (i32.const "}"))
              (then (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))))
            (local.set $b (i32.add (local.get $b) (i32.const 1)))
            (br_if $brace (local.get $depth)))
          (call $emitTok (enum.get $Token.comment.doc) (local.get $seg) (local.get $q))
          (call $emitTok (enum.get $Token.punctuation.bracket)
            (local.get $q) (i32.add (local.get $q) (i32.const 1)))
          (call $emitTok (enum.get $Token.type.jsdoc)
            (i32.add (local.get $q) (i32.const 1)) (i32.sub (local.get $b) (i32.const 1)))
          (call $emitTok (enum.get $Token.punctuation.bracket)
            (i32.sub (local.get $b) (i32.const 1)) (local.get $b))
          (local.set $seg (local.get $b))
          (local.set $p (local.get $b)))
        ;; the tag's name argument
        (if (local.get $isParam)
          (then
            (block $noName
              (local.set $q (local.get $p))
              (loop $sp2
                (br_if $noName (i32.ge_u (local.get $q) (local.get $rhs)))
                (local.set $c (i32.load8_u (local.get $q)))
                (if (i32.or (i32.eq (local.get $c) (i32.const 32))
                            (i32.eq (local.get $c) (i32.const 9)))
                  (then
                    (local.set $q (i32.add (local.get $q) (i32.const 1)))
                    (br $sp2))))
              (local.set $b (local.get $q))
              (block $nameEnd
                (loop $name
                  (br_if $nameEnd (i32.ge_u (local.get $b) (local.get $rhs)))
                  (br_if $nameEnd (i32.eqz (call $docNameChar (i32.load8_u (local.get $b)))))
                  (local.set $b (i32.add (local.get $b) (i32.const 1)))
                  (br $name)))
              (br_if $noName (i32.eq (local.get $b) (local.get $q)))
              (call $emitTok (enum.get $Token.comment.doc) (local.get $seg) (local.get $q))
              (call $emitTok (enum.get $Token.variable.jsdoc) (local.get $q) (local.get $b))
              (local.set $seg (local.get $b))
              (local.set $p (local.get $b)))))
        (br $scan)))
    (call $emitTok (enum.get $Token.comment.doc) (local.get $seg) (local.get $rhs)))

  (func $emitDocComment (param $lhs i32) (param $rhs i32)
    (call $emitDocCommentRange (local.get $lhs) (local.get $rhs) (i32.const 3)))

  ;; Entry points compose with the shared pipeline in tsx.wat.
  (func $hlJs (call $hlEcma (i32.const 0)))
  (func $hlJsStream (param $reset i32)
    (call $hlEcmaStream (i32.const 0) (local.get $reset)))
)
