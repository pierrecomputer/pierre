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

  ;; tokenizer state (initialized on every $hlTsx entry)
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

  ;; jsx mode stack entries
  ;; mode 1 = TAG (inside an open tag, scanning attributes)
  ;; mode 2 = CONTENT (between > and </, scanning children)
  ;; mode 3 = CONTAINER ({expr}: the token pipeline runs until braceDepth
  ;;          returns to the recorded target)
  ;; like $brkPush, pushes past the 512-entry capacity are dropped but still
  ;; COUNTED, so every pop matches its push and the stored entries are correct
  ;; again once the depth returns below capacity; top accesses clamp to the
  ;; deepest stored entry meanwhile
  (func $jsxPush (param $mode i32) (param $target i32)
    (if (i32.lt_u (global.get $jsxSp) (i32.const 512))
      (then
        (i32.store (i32.add (i32.const $mem.tsxJsxStack) (i32.shl (global.get $jsxSp) (i32.const 3)))
          (local.get $mode))
        (i32.store offset=4 (i32.add (i32.const $mem.tsxJsxStack) (i32.shl (global.get $jsxSp) (i32.const 3)))
          (local.get $target))))
    (global.set $jsxSp (i32.add (global.get $jsxSp) (i32.const 1))))
  ;; address of the top entry, clamped to the last stored one ($jsxSp > 0)
  (func $jsxTopSlot (result i32)
    (local $i i32)
    (local.set $i (i32.sub (global.get $jsxSp) (i32.const 1)))
    (if (i32.gt_u (local.get $i) (i32.const 511))
      (then (local.set $i (i32.const 511))))
    (i32.add (i32.const $mem.tsxJsxStack) (i32.shl (local.get $i) (i32.const 3))))
  (func $jsxTopMode (result i32)
    (if (i32.eqz (global.get $jsxSp)) (then (return (i32.const 0))))
    (i32.load (call $jsxTopSlot)))
  (func $jsxTopTarget (result i32)
    (if (i32.eqz (global.get $jsxSp)) (then (return (i32.const 0))))
    (i32.load offset=4 (call $jsxTopSlot)))
  (func $jsxSetTopMode (param $mode i32)
    (if (i32.eqz (global.get $jsxSp)) (then (return)))
    (i32.store (call $jsxTopSlot) (local.get $mode)))
  ;; pop one element. Whatever completed - an element or a container - is an
  ;; ended expression, so the following tokens must see it as one (identifier):
  ;; also INSIDE a container, or `{<b/> / 2}` would read the `/` as a regexp
  (func $jsxPop
    (if (global.get $jsxSp)
      (then (global.set $jsxSp (i32.sub (global.get $jsxSp) (i32.const 1)))))
    (global.set $prevTok (enum.get $Lex.identifier))
    (global.set $lto (enum.get $Lex.identifier)))

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

  ;; quoted string; $ptr is on the opening quote. $end-clamped 16-byte scan.
  (func $scanString (param $quote i32) (result i32)
    (local $c i32)
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
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
      (then (return (enum.get $Lex.eof))))
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
    (if (i32.eqz (bitset.get $LexBits.comment (local.get $t)))
      (then
        (global.set $prevLto (global.get $lto))
        (global.set $lto (local.get $t))))
    (local.get $t))

  ;; Return the byte after the `}` balancing the `{` at $from. This reuses the
  ;; real token scanner, then restores $ptr; unterminated expressions reach
  ;; $end. $body may start after a Svelte block/directive marker.
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
  (func $emitDocComment (param $lhs i32) (param $rhs i32)
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
    (local.set $p (i32.add (local.get $lhs) (i32.const 3))) ;; skip `/**`
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
        (local.set $c (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))
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

  ;; $Token bucket for a proper keyword token, mirroring Zed's typescript query:
  ;; control flow and declaration introducers get their own buckets, literal
  ;; keywords their literal kinds, everything else - new/typeof/in/void/... -
  ;; stays plain `keyword`
  (func $kwHl (param $t i32) (result i32)
    (if (bitset.get $LexBits.kwControl (local.get $t))
      (then (return (enum.get $Token.keyword.control))))
    (if (bitset.get $LexBits.kwDecl (local.get $t))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.or (i32.eq (local.get $t) (enum.get $Lex.keyword_import))
                (i32.eq (local.get $t) (enum.get $Lex.keyword_export)))
      (then (return (enum.get $Token.keyword.import))))
    (if (i32.or (i32.eq (local.get $t) (enum.get $Lex.keyword_true))
                (i32.eq (local.get $t) (enum.get $Lex.keyword_false)))
      (then (return (enum.get $Token.boolean))))
    (if (i32.eq (local.get $t) (enum.get $Lex.keyword_null))
      (then (return (enum.get $Token.constant.builtin))))
    (if (i32.or (i32.eq (local.get $t) (enum.get $Lex.keyword_this))
                (i32.eq (local.get $t) (enum.get $Lex.keyword_super)))
      (then (return (enum.get $Token.variable.special))))
    (enum.get $Token.keyword))

  ;; identifier-like next token: an identifier, keyword, or contextual word -
  ;; the cheap "does this ctxword read as a keyword here" test
  (func $isIdentish (param $t i32) (result i32)
    (i32.or
      (i32.eq (local.get $t) (enum.get $Lex.identifier))
      (i32.and (i32.ge_u (local.get $t) (enum.get $Lex.keyword_break))
               (i32.le_u (local.get $t) (enum.get $Lex.ctxword_type)))))

  ;; undefined / NaN / Infinity spelled out
  (func $isBuiltinConst (param $lhs i32) (param $rhs i32) (result i32)
    (local $len i32)
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.eq (local.get $len) (i32.const 9))
      (then
        (return (i32.and
          (i64.eq (i64.load (local.get $lhs)) (i64.const "undefine"))
          (i32.eq (i32.load8_u offset=8 (local.get $lhs)) (i32.const "d"))))))
    (if (i32.eq (local.get $len) (i32.const 3))
      (then
        (return (i32.eq (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff))
                        (i32.const "NaN")))))
    (if (i32.eq (local.get $len) (i32.const 8))
      (then
        (return (i64.eq (i64.load (local.get $lhs)) (i64.const "Infinity")))))
    (i32.const 0))

  ;; lowercase predefined types that Zed captures as type.builtin
  (func $isPredefinedType (param $lhs i32) (param $rhs i32) (result i32)
    (local $len i32)
    (local $w i64)
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))
    (local.set $w (i64.load (local.get $lhs)))
    (if (i32.eq (local.get $len) (i32.const 3))
      (then (return (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "any")))))
    (if (i32.eq (local.get $len) (i32.const 5))
      (then (return (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "never")))))
    (if (i32.eq (local.get $len) (i32.const 6))
      (then
        (local.set $w (i64.and (local.get $w) (i64.const 0xffffffffffff)))
        (return (i32.or
          (i32.or (i64.eq (local.get $w) (i64.const "number"))
                  (i64.eq (local.get $w) (i64.const "string")))
          (i32.or (i64.eq (local.get $w) (i64.const "symbol"))
                  (i64.eq (local.get $w) (i64.const "object")))))))
    (if (i32.eq (local.get $len) (i32.const 7))
      (then
        (local.set $w (i64.and (local.get $w) (i64.const 0xffffffffffffff)))
        (return (i32.or (i64.eq (local.get $w) (i64.const "boolean"))
                        (i64.eq (local.get $w) (i64.const "unknown"))))))
    (i32.const 0))

  ;; classify an identifier or contextual word from its neighbors
  (func $identHl (param $prev i32) (param $t i32) (param $next i32)
        (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    ;; contextual words in keyword position first (cheap heuristics)
    (if (i32.eq (local.get $t) (enum.get $Lex.ctxword_await))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.eq (local.get $t) (enum.get $Lex.ctxword_async))
      (then
        (if (i32.or (call $isIdentish (local.get $next))
                    (i32.eq (local.get $next) (enum.get $Lex.l_paren)))
          (then (return (enum.get $Token.keyword))))))
    (if (i32.eq (local.get $t) (enum.get $Lex.ctxword_of))
      (then
        (if (bitset.get $LexBits.exprEnd (local.get $prev))
          (then (return (enum.get $Token.keyword))))))
    (if (i32.eq (local.get $t) (enum.get $Lex.ctxword_keyof))
      (then
        (if (i32.or (call $isIdentish (local.get $next))
                    (i32.eq (local.get $next) (enum.get $Lex.l_paren)))
          (then (return (enum.get $Token.keyword))))))
    (if (i32.eq (local.get $t) (enum.get $Lex.ctxword_from))
      (then
        (if (i32.eq (local.get $next) (enum.get $Lex.string_literal))
          (then (return (enum.get $Token.keyword.import))))))
    (if (i32.eq (local.get $t) (enum.get $Lex.ctxword_as))
      (then
        (if (call $isIdentish (local.get $next))
          (then (return (enum.get $Token.keyword))))))
    ;; the remaining ctxwords - type/satisfies/is/declare/abstract/namespace/
    ;; readonly/override/infer/get/set - read as keywords before a name;
    ;; `type` introduces a declaration, so it lands in Zed's declaration bucket
    (if (i32.and (i32.ge_u (local.get $t) (enum.get $Lex.ctxword_get))
                 (i32.le_u (local.get $t) (enum.get $Lex.ctxword_type)))
      (then
        (if (i32.and
              (i32.ne (local.get $t) (enum.get $Lex.ctxword_of))
              (call $isIdentish (local.get $next)))
          (then
            (return (select
              (enum.get $Token.keyword.declaration) (enum.get $Token.keyword)
              (i32.eq (local.get $t) (enum.get $Lex.ctxword_type))))))))
    ;; member access
    (if (i32.or (i32.eq (local.get $prev) (enum.get $Lex.dot))
                (i32.eq (local.get $prev) (enum.get $Lex.question_mark_dot)))
      (then
        (if (i32.eq (local.get $next) (enum.get $Lex.l_paren))
          (then (return (enum.get $Token.function.method))))
        (return (enum.get $Token.property))))
    (if (call $isBuiltinConst (local.get $lhs) (local.get $rhs))
      (then (return (enum.get $Token.constant.builtin))))
    (if (i32.and (i32.eq (local.get $prev) (enum.get $Lex.colon))
                 (call $isPredefinedType (local.get $lhs) (local.get $rhs)))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.eq (local.get $prev) (enum.get $Lex.keyword_new))
      (then (return (enum.get $Token.type.class))))
    ;; declared type names, before the SCREAMING_CASE constant rule can fire:
    ;; class/extends heads are Zed's type.class, interface/enum/type names type
    (if (i32.or (i32.eq (local.get $prev) (enum.get $Lex.keyword_class))
                (i32.eq (local.get $prev) (enum.get $Lex.keyword_extends)))
      (then (return (enum.get $Token.type.class))))
    (if (i32.or
          (i32.or (i32.eq (local.get $prev) (enum.get $Lex.keyword_interface))
                  (i32.eq (local.get $prev) (enum.get $Lex.keyword_enum)))
          (i32.eq (local.get $prev) (enum.get $Lex.ctxword_type)))
      (then (return (enum.get $Token.type))))
    (if (i32.eq (local.get $prev) (enum.get $Lex.keyword_function))
      (then (return (enum.get $Token.function))))
    ;; object / type-member key: `{`/`,`/`;` before - `;` separates interface
    ;; and type-literal members - and `:` after, or `?` when the `:` follows it
    ;; directly (a TS optional member; a ternary `?` never touches its `:`).
    ;; the pipeline already scanned $next, so the tokenizer global $rhs - not
    ;; the $rhs param, the current token's end - is its end: the byte there is
    ;; the one after the `?`
    (if (i32.and
          (i32.or
            (i32.or (i32.eq (local.get $prev) (enum.get $Lex.l_brace))
                    (i32.eq (local.get $prev) (enum.get $Lex.comma)))
            (i32.eq (local.get $prev) (enum.get $Lex.semicolon)))
          (i32.or
            (i32.eq (local.get $next) (enum.get $Lex.colon))
            (i32.and (i32.eq (local.get $next) (enum.get $Lex.question_mark))
                     (i32.eq (call $tsxByte (global.get $rhs)) (i32.const ":")))))
      (then (return (enum.get $Token.property))))
    (if (i32.eq (local.get $next) (enum.get $Lex.l_paren))
      (then (return (enum.get $Token.function))))
    ;; SCREAMING_CASE names are constants - Zed's ^_*[A-Z_][A-Z\d_]*$ rule -
    ;; and other Uppercase-initial names are types, deliberately
    (if (call $isConstCase (local.get $lhs) (local.get $rhs))
      (then (return (enum.get $Token.constant))))
    (local.set $c (i32.load8_u (local.get $lhs)))
    (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
      (then (return (enum.get $Token.type))))
    (enum.get $Token.variable))

  ;; every byte in [A-Z0-9_], with an identifier-start first byte: the token
  ;; reads as a SCREAMING_CASE constant
  (func $isConstCase (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    (block $no
      (loop $l
        (if (i32.ge_u (local.get $lhs) (local.get $rhs))
          (then (return (i32.const 1))))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (block $ok
          (br_if $ok (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))
          (br_if $ok (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9)))
          (br_if $ok (i32.eq (local.get $c) (i32.const "_")))
          (br $no))
        (local.set $lhs (i32.add (local.get $lhs) (i32.const 1)))
        (br $l)))
    (i32.const 0))

  ;; classify a single-span token from (prev, cur, next); multi-part kinds
  ;; - strings, templates, comments - are handled by the pipeline itself
  (func $classify (param $prev i32) (param $t i32) (param $next i32)
        (param $lhs i32) (param $rhs i32) (result i32)
    (if (i32.and
          (i32.eq (local.get $t) (enum.get $Lex.colon))
          (i32.and
            (i32.eq (local.get $next) (enum.get $Lex.identifier))
            (i32.or
              (call $isPredefinedType (global.get $lhs) (global.get $rhs))
              (i32.le_u
                (i32.sub (call $tsxByte (global.get $lhs)) (i32.const "A"))
                (i32.const 25)))))
      (then (return (enum.get $Token.punctuation.special))))
    (if (i32.and (i32.eq (local.get $t) (enum.get $Lex.question_mark))
                 (i32.eq (local.get $next) (enum.get $Lex.colon)))
      (then (return (enum.get $Token.punctuation.special))))
    (if (i32.or
          (i32.or
            (i32.or (i32.eq (local.get $t) (enum.get $Lex.l_paren))
                    (i32.eq (local.get $t) (enum.get $Lex.r_paren)))
            (i32.or (i32.eq (local.get $t) (enum.get $Lex.l_bracket))
                    (i32.eq (local.get $t) (enum.get $Lex.r_bracket))))
          (i32.or (i32.eq (local.get $t) (enum.get $Lex.l_brace))
                  (i32.eq (local.get $t) (enum.get $Lex.r_brace))))
      (then (return (enum.get $Token.punctuation.bracket))))
    (if (i32.or
          (i32.or
            (i32.or (i32.eq (local.get $t) (enum.get $Lex.comma))
                    (i32.eq (local.get $t) (enum.get $Lex.semicolon)))
            (i32.or (i32.eq (local.get $t) (enum.get $Lex.colon))
                    (i32.eq (local.get $t) (enum.get $Lex.dot))))
          (i32.eq (local.get $t) (enum.get $Lex.question_mark_dot)))
      (then (return (enum.get $Token.punctuation.delimiter))))
    (if (i32.or (i32.eq (local.get $t) (enum.get $Lex.number_literal))
                (i32.eq (local.get $t) (enum.get $Lex.bigint_literal)))
      (then (return (enum.get $Token.number))))
    (if (i32.eq (local.get $t) (enum.get $Lex.regexp_literal))
      (then (return (enum.get $Token.string.regex))))
    (if (i32.eq (local.get $t) (enum.get $Lex.at_identifier))
      (then (return (enum.get $Token.attribute))))
    (if (i32.eq (local.get $t) (enum.get $Lex.hash_identifier))
      (then (return (enum.get $Token.property))))
    (if (i32.or
          (i32.eq (local.get $t) (enum.get $Lex.identifier))
          (i32.and (i32.ge_u (local.get $t) (enum.get $Lex.ctxword_as))
                   (i32.le_u (local.get $t) (enum.get $Lex.ctxword_type))))
      (then (return (call $identHl (local.get $prev) (local.get $t) (local.get $next)
                                   (local.get $lhs) (local.get $rhs)))))
    (if (i32.and (i32.ge_u (local.get $t) (enum.get $Lex.keyword_break))
                 (i32.le_u (local.get $t) (enum.get $Lex.keyword_yield)))
      (then (return (call $kwHl (local.get $t)))))
    ;; every remaining token below the keyword range is an operator
    (if (i32.and (i32.ge_u (local.get $t) (enum.get $Lex.ampersand_ampersand_equal))
                 (i32.le_u (local.get $t) (enum.get $Lex.yield_asterisk)))
      (then (return (enum.get $Token.operator))))
    (enum.get $Token.none))

  ;; ---- JSX ----

  ;; [A-Za-z_$]
  (func $jsxNameStart (param $c i32) (result i32)
    (i32.or
      (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
      (i32.or (i32.eq (local.get $c) (i32.const "_")) (i32.eq (local.get $c) (i32.const "$")))))

  ;; tag-name continue: [A-Za-z0-9_$.:-]
  (func $jsxNameCont (param $c i32) (result i32)
    (i32.or
      (i32.or
        (call $jsxNameStart (local.get $c))
        (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9)))
      (i32.or
        (i32.eq (local.get $c) (i32.const "."))
        (i32.or (i32.eq (local.get $c) (i32.const ":"))
                (i32.eq (local.get $c) (i32.const "-"))))))

  ;; does the byte shape after the `<` at $p look like a JSX tag? pure
  ;; lookahead, consumes nothing. `<>`, or a name followed by `>`/`/`/`{`/
  ;; quote/another name - anything else bails to a comparison operator.
  (func $jsxValidate (param $p i32) (result i32)
    (local $c i32)
    (if (i32.ge_u (local.get $p) (global.get $end)) (then (return (i32.const 0))))
    (local.set $c (i32.load8_u (local.get $p)))
    (if (i32.eq (local.get $c) (i32.const ">")) (then (return (i32.const 1))))
    (if (i32.eqz (call $jsxNameStart (local.get $c))) (then (return (i32.const 0))))
    ;; the tag name
    (block $nameDone
      (loop $name
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br_if $nameDone (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $name (call $jsxNameCont (i32.load8_u (local.get $p))))))
    ;; whitespace
    (block $wsDone
      (loop $ws
        (br_if $wsDone (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $wsDone (i32.eqz (i32.or
          (i32.eq (local.get $c) (i32.const 32))
          (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $ws)))
    (if (i32.ge_u (local.get $p) (global.get $end)) (then (return (i32.const 1))))
    (local.set $c (i32.load8_u (local.get $p)))
    (i32.or
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const ">"))
                (i32.eq (local.get $c) (i32.const "/")))
        (i32.or (i32.eq (local.get $c) (i32.const "{"))
                (call $jsxNameStart (local.get $c))))
      (i32.or (i32.eq (local.get $c) (i32.const 34))
              (i32.eq (local.get $c) (i32.const 39)))))

  ;; scan + emit the tag name at $ptr: lowercase simple names are `tag.jsx`,
  ;; Capitalized or dotted names are `tag.component.jsx` - Zed's tsx captures.
  ;; empty names - fragments - emit nothing.
  (func $jsxEmitName
    (local $from i32)
    (local $c i32)
    (local $dotted i32)
    (local.set $from (global.get $ptr))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (br_if $done (i32.eqz (call $jsxNameCont (local.get $c))))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then (local.set $dotted (i32.const 1))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l)))
    (if (i32.gt_u (global.get $ptr) (local.get $from))
      (then
        (call $emitTok
          (select (enum.get $Token.tag.component.jsx) (enum.get $Token.tag.jsx)
            (i32.or (local.get $dotted)
              (i32.le_u (i32.sub (i32.load8_u (local.get $from)) (i32.const "A")) (i32.const 25))))
          (local.get $from) (global.get $ptr)))))

  ;; a `{` at $ptr opens an expression container: pull the l_brace through the
  ;; tokenizer so brace/template bookkeeping stays consistent, then let the
  ;; token pipeline run until braceDepth returns to the recorded target
  (func $jsxOpenContainer
    (drop (call $nextToken))
    (call $emitTok (enum.get $Token.punctuation.bracket) (global.get $lhs) (global.get $rhs))
    (call $jsxPush (i32.const 3) (i32.sub (global.get $braceDepth) (i32.const 1)))
    (global.set $prevTok (enum.get $Lex.l_brace)))

  ;; one step inside an open tag: whitespace, then one attribute piece or the
  ;; tag end. always advances $ptr or changes mode.
  (func $jsxTagStep
    (local $from i32)
    (local $c i32)
    (local $q i32)
    (local.set $from (global.get $ptr))
    (block $wsDone
      (loop $ws
        (br_if $wsDone (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (br_if $wsDone (i32.eqz (i32.or
          (i32.eq (local.get $c) (i32.const 32))
          (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4)))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $ws)))
    (call $emitGap (local.get $from) (global.get $ptr))
    (if (i32.ge_u (global.get $ptr) (global.get $end)) (then (return)))
    (local.set $from (global.get $ptr))
    ;; `>` - the tag opens: children follow
    (if (i32.eq (local.get $c) (i32.const ">"))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.bracket.jsx) (local.get $from) (global.get $ptr))
        (call $jsxSetTopMode (i32.const 2))
        (return)))
    ;; `/>` - self-closing
    (if (i32.and (i32.eq (local.get $c) (i32.const "/"))
                 (i32.eq (call $tsxByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const ">")))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
        (call $emitTok (enum.get $Token.punctuation.bracket.jsx) (local.get $from) (global.get $ptr))
        (call $jsxPop)
        (return)))
    ;; `{` - spread attribute or expression value
    (if (i32.eq (local.get $c) (i32.const "{"))
      (then
        (call $jsxOpenContainer)
        (return)))
    ;; quoted attribute value (may span lines; no escapes in JSX strings)
    (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
      (then
        (local.set $q (local.get $c))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (block $sDone
          (loop $s
            (br_if $sDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br_if $sDone (i32.eq (local.get $c) (local.get $q)))
            (br $s)))
        (call $emitTok (enum.get $Token.string) (local.get $from) (global.get $ptr))
        (return)))
    ;; `=` between an attribute name and its value
    (if (i32.eq (local.get $c) (i32.const "="))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.delimiter.jsx) (local.get $from) (global.get $ptr))
        (return)))
    ;; attribute name
    (if (call $jsxNameStart (local.get $c))
      (then
        (block $nDone
          (loop $n
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br_if $nDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (br_if $n (call $jsxNameCont (i32.load8_u (global.get $ptr))))))
        (call $emitTok (enum.get $Token.attribute.jsx) (local.get $from) (global.get $ptr))
        (return)))
    ;; anything else: one lenient plain byte
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (call $emitTok (enum.get $Token.none) (local.get $from) (global.get $ptr)))

  ;; one step between `>` and the closing tag: a text run, then one structural
  ;; item - a child tag, a close tag, a `{...}` container, or a stray byte
  (func $jsxContentStep
    (local $seg i32)
    (local $c i32)
    (local $c2 i32)
    (local $p i32)
    (local.set $seg (global.get $ptr))
    ;; text run up to `<` or `{`; `&entity;` gets a string.special span
    (block $textDone
      (loop $text
        (br_if $textDone (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (br_if $textDone (i32.or (i32.eq (local.get $c) (i32.const "<"))
                                 (i32.eq (local.get $c) (i32.const "{"))))
        (if (i32.eq (local.get $c) (i32.const "&"))
          (then
            (local.set $p (i32.add (global.get $ptr) (i32.const 1)))
            (block $eDone
              (loop $e
                (br_if $eDone (i32.ge_u (local.get $p) (global.get $end)))
                (local.set $c2 (i32.load8_u (local.get $p)))
                (br_if $eDone (i32.eqz (i32.or
                  (i32.or
                    (i32.le_u (i32.sub (i32.or (local.get $c2) (i32.const 32)) (i32.const "a")) (i32.const 25))
                    (i32.le_u (i32.sub (local.get $c2) (i32.const "0")) (i32.const 9)))
                  (i32.eq (local.get $c2) (i32.const "#")))))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $e)))
            (if (i32.and
                  (i32.gt_u (local.get $p) (i32.add (global.get $ptr) (i32.const 1)))
                  (i32.and (i32.lt_u (local.get $p) (global.get $end))
                           (i32.eq (call $tsxByte (local.get $p)) (i32.const ";"))))
              (then
                (call $emitTok (enum.get $Token.text.jsx) (local.get $seg) (global.get $ptr))
                (call $emitTok (enum.get $Token.string.special)
                  (global.get $ptr) (i32.add (local.get $p) (i32.const 1)))
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (local.set $seg (global.get $ptr))
                (br $text)))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $text)))
    (call $emitTok (enum.get $Token.text.jsx) (local.get $seg) (global.get $ptr))
    (if (i32.ge_u (global.get $ptr) (global.get $end)) (then (return)))
    ;; `{` container
    (if (i32.eq (local.get $c) (i32.const "{"))
      (then
        (call $jsxOpenContainer)
        (return)))
    ;; `<...`
    (local.set $seg (global.get $ptr))
    (local.set $c2 (call $tsxByte (i32.add (global.get $ptr) (i32.const 1))))
    ;; `</name >` closes this element
    (if (i32.eq (local.get $c2) (i32.const "/"))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
        (call $emitTok (enum.get $Token.punctuation.bracket.jsx) (local.get $seg) (global.get $ptr))
        (call $jsxEmitName)
        ;; lenient tail: whitespace, then `>`; stray bytes stay plain
        (block $tDone
          (loop $t
            (local.set $seg (global.get $ptr))
            (block $wsDone
              (loop $ws
                (br_if $wsDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c (i32.load8_u (global.get $ptr)))
                (br_if $wsDone (i32.eqz (i32.or
                  (i32.eq (local.get $c) (i32.const 32))
                  (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4)))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $ws)))
            (call $emitGap (local.get $seg) (global.get $ptr))
            (br_if $tDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $seg (global.get $ptr))
            (if (i32.eq (local.get $c) (i32.const ">"))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.bracket.jsx) (local.get $seg) (global.get $ptr))
                (br $tDone)))
            ;; a `<` here starts something new: stop the close tag leniently
            (br_if $tDone (i32.eq (local.get $c) (i32.const "<")))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.none) (local.get $seg) (global.get $ptr))
            (br $t)))
        (call $jsxPop)
        (return)))
    ;; `<name` / `<>` opens a child
    (if (i32.or (call $jsxNameStart (local.get $c2)) (i32.eq (local.get $c2) (i32.const ">")))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.bracket.jsx) (local.get $seg) (global.get $ptr))
        (call $jsxEmitName)
        (call $jsxPush (i32.const 1) (i32.const 0))
        (return)))
    ;; a stray `<`: plain text
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (call $emitTok (enum.get $Token.text.jsx) (local.get $seg) (global.get $ptr)))

  ;; emit one classified token, splitting the multi-part kinds
  (func $emitCur (param $t i32) (param $lhs i32) (param $rhs i32) (param $next i32)
    (local $c i32)
    (if (i32.eq (local.get $t) (enum.get $Lex.string_literal))
      (then
        (call $emitEscaped (enum.get $Token.string) (local.get $lhs) (local.get $rhs))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Lex.backtick))
      (then
        (call $emitTemplate (local.get $lhs) (local.get $rhs) (i32.const 0))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Lex.dollar_brace))
      (then
        (call $emitTemplate (local.get $lhs) (local.get $rhs) (i32.const 1))
        (return)))
    (if (i32.or (i32.eq (local.get $t) (enum.get $Lex.comment))
                (i32.eq (local.get $t) (enum.get $Lex.hash_bang)))
      (then
        (call $emitTok (enum.get $Token.comment) (local.get $lhs) (local.get $rhs))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Lex.multiline_comment))
      (then
        ;; `/** ... */` but not `/**/` is a doc comment with JSDoc tags
        (if (i32.and
              (i32.eq (i32.load8_u offset=2 (local.get $lhs)) (i32.const "*"))
              (i32.gt_u (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 4)))
          (then (call $emitDocComment (local.get $lhs) (local.get $rhs)))
          (else (call $emitTok (enum.get $Token.comment) (local.get $lhs) (local.get $rhs))))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Lex.invalid))
      (then
        ;; unterminated literals keep their color, judged by the first byte
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $emitEscaped (enum.get $Token.string) (local.get $lhs) (local.get $rhs))
            (return)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "`")) (i32.eq (local.get $c) (i32.const "}")))
          (then
            (call $emitTemplate (local.get $lhs) (local.get $rhs) (i32.const 0))
            (return)))
        (if (i32.eq (local.get $c) (i32.const "/"))
          (then
            (call $emitTok (enum.get $Token.string.regex) (local.get $lhs) (local.get $rhs))
            (return)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (local.get $rhs))
        (return)))
    (call $emitTok
      (call $classify (global.get $prevTok) (local.get $t) (local.get $next)
                      (local.get $lhs) (local.get $rhs))
      (local.get $lhs) (local.get $rhs)))

  ;; the lexer: a one-token-lookahead pipeline over $nextToken, with the
  ;; jsx byte modes layered on top (see the mode stack above)
  (func $hlTsx
    (local $curT i32)
    (local $curLhs i32)
    (local $curRhs i32)
    (local $nxtT i32)
    (local $nxtLhs i32)
    (local $nxtRhs i32)
    (local $haveNext i32)
    (local $done i32)
    (local $m i32)
    (call $lexEmitLeadingContinuation)
    (global.set $sourceStart (global.get $ptr))
    (global.set $lto (enum.get $Lex.eof))
    (global.set $prevLto (enum.get $Lex.eof))
    (global.set $prevTok (enum.get $Lex.eof))
    (global.set $nlBefore (i32.const 0))
    (global.set $braceDepth (i32.const 0))
    (global.set $tmplSp (i32.const 0))
    (global.set $brkSp (i32.const 0))
    (global.set $rxCloser (i32.const 0))
    (global.set $jsxSp (i32.const 0))
    (local.set $done (global.get $ptr))
    (block $out
      (loop $main
        ;; jsx TAG/CONTENT modes scan bytes, not tokens
        (local.set $m (call $jsxTopMode))
        (if (i32.and (i32.ne (local.get $m) (i32.const 0))
                     (i32.ne (local.get $m) (i32.const 3)))
          (then
            (br_if $out (i32.ge_u (global.get $ptr) (global.get $end)))
            (if (i32.eq (local.get $m) (i32.const 1))
              (then (call $jsxTagStep))
              (else (call $jsxContentStep)))
            (local.set $done (global.get $ptr))
            (br $main)))
        ;; pull the current token (the previous iteration's lookahead, if any)
        (if (local.get $haveNext)
          (then
            (local.set $curT (local.get $nxtT))
            (local.set $curLhs (local.get $nxtLhs))
            (local.set $curRhs (local.get $nxtRhs))
            (local.set $haveNext (i32.const 0)))
          (else
            (local.set $curT (call $nextToken))
            (local.set $curLhs (global.get $lhs))
            (local.set $curRhs (global.get $rhs))))
        (call $emitGap (local.get $done) (local.get $curLhs))
        (local.set $done (local.get $curLhs))
        (br_if $out (i32.eq (local.get $curT) (enum.get $Lex.eof)))
        ;; a `}` that closes a jsx expression container resumes the tag/content
        (if (i32.and (i32.eq (local.get $curT) (enum.get $Lex.r_brace))
                     (i32.eq (local.get $m) (i32.const 3)))
          (then
            (if (i32.le_s (global.get $braceDepth) (call $jsxTopTarget))
              (then
                (call $emitTok (enum.get $Token.punctuation.bracket)
                  (local.get $curLhs) (local.get $curRhs))
                (local.set $done (local.get $curRhs))
                (call $jsxPop)
                (br $main)))))
        ;; a `<` in operand position with a tag-like shape opens JSX; without
        ;; the shape it falls through and stays a comparison operator
        (if (i32.and (i32.eq (local.get $curT) (enum.get $Lex.l_angle))
                     (call $jsxCanStart (global.get $prevTok)))
          (then
            (if (call $jsxValidate (local.get $curRhs))
              (then
                (call $emitTok (enum.get $Token.punctuation.bracket.jsx)
                  (local.get $curLhs) (local.get $curRhs))
                (call $jsxEmitName)
                (call $jsxPush (i32.const 1) (i32.const 0))
                (local.set $done (global.get $ptr))
                (br $main)))))
        ;; lookahead, then emit the current token
        (local.set $nxtT (call $nextToken))
        (local.set $nxtLhs (global.get $lhs))
        (local.set $nxtRhs (global.get $rhs))
        (local.set $haveNext (i32.const 1))
        (call $emitCur (local.get $curT) (local.get $curLhs) (local.get $curRhs)
                       (local.get $nxtT))
        (local.set $done (local.get $curRhs))
        (if (i32.eqz (bitset.get $LexBits.comment (local.get $curT)))
          (then (global.set $prevTok (local.get $curT))))
        (br $main)))
    (global.set $ptr (global.get $end)))
)
