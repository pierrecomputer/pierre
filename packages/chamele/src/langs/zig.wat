(module
  (import "../common.wat")

  (func $zigByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  (func $zigIsIdentStart (param $c i32) (result i32)
    (i32.or
      (i32.le_u
        (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a"))
        (i32.const 25))
      (i32.eq (local.get $c) (i32.const "_"))))

  (func $zigIdentEnd (param $p i32) (result i32)
    (local $c i32)
    (block $done
      (loop $byte
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $done
          (i32.eqz (i32.or
            (call $zigIsIdentStart (local.get $c))
            (call $lexIsDigit (local.get $c)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $byte)))
    (local.get $p))

  (func $zigIsDigitForBase (param $c i32) (param $base i32) (result i32)
    (select
      (call $lexIsHex (local.get $c))
      (i32.lt_u (i32.sub (local.get $c) (i32.const "0")) (local.get $base))
      (i32.eq (local.get $base) (i32.const 16))))

  ;; Zig separators occur only between two digits.
  (func $zigScanDigits (param $p i32) (param $base i32) (result i32)
    (local $start i32)
    (local.set $start (local.get $p))
    (block $done
      (loop $digit
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (if (call $zigIsDigitForBase
              (i32.load8_u (local.get $p)) (local.get $base))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $digit)))
        (br_if $done
          (i32.or
            (i32.eq (local.get $p) (local.get $start))
            (i32.ne (i32.load8_u (local.get $p)) (i32.const "_"))))
        (br_if $done
          (i32.or
            (i32.ge_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
            (i32.eqz (call $zigIsDigitForBase
              (i32.load8_u offset=1 (local.get $p)) (local.get $base)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $digit)))
    (local.get $p))

  ;; Single-line strings, code-point literals, and quoted identifiers share
  ;; the same escape grammar.
  (func $zigString (param $quote i32) (param $hl i32)
    (local $c i32)
    (local $e i32)
    (local $seg i32)
    (local.set $seg (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (block $done
      (loop $scan
        (global.set $ptr (call $scanFindSpecial
          (global.get $ptr) (global.get $end) (local.get $quote)
          (i32.const 1) (i32.const 1)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $quote))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $done)))
        (br_if $done
          (i32.or
            (i32.eq (local.get $c) (i32.const 10))
            (i32.eq (local.get $c) (i32.const 13))))
        ;; the scan stops only on the quote, a line break, or a backslash, so
        ;; the rest of the body is the escape case
        (br_if $done (i32.ne (local.get $c) (i32.const 92)))
        (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
        (local.set $e (i32.add (global.get $ptr) (i32.const 1)))
        (if (i32.lt_u (local.get $e) (global.get $end))
          (then
            (local.set $c (i32.load8_u (local.get $e)))
            (if (i32.and
                  (i32.ne (local.get $c) (i32.const 10))
                  (i32.ne (local.get $c) (i32.const 13)))
              (then
                (local.set $e (i32.add (local.get $e) (i32.const 1)))
                (if (i32.eq (local.get $c) (i32.const "x"))
                  (then
                    (local.set $e
                      (call $scanHexRun (local.get $e) (i32.const 2)))))
                ;; a code point escape holds at most six hex digits
                (if (i32.and
                      (i32.eq (local.get $c) (i32.const "u"))
                      (i32.eq (call $zigByte (local.get $e)) (i32.const "{")))
                  (then
                    (local.set $e (call $scanHexRun
                      (i32.add (local.get $e) (i32.const 1)) (i32.const 6)))
                    (if (i32.eq (call $zigByte (local.get $e)) (i32.const "}"))
                      (then
                        (local.set $e
                          (i32.add (local.get $e) (i32.const 1)))))))))))
        (local.set $e (call $utf8SpanEnd (local.get $e) (global.get $end)))
        (call $emitTok
          (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
        (global.set $ptr (local.get $e))
        (local.set $seg (global.get $ptr))
        (br $scan)))
    (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr)))

  ;; IDs are stored as raw bytes in the records and hash table below.
  (enum $ZigWord
    "invalid"
    "fn" "const" "var" "struct" "enum" "union" "opaque" "if"
    "else" "switch" "for" "while" "break" "continue" "return" "defer"
    "errdefer" "try" "catch" "suspend" "nosuspend" "resume"
    "export" "and" "or" "orelse" "bool" "void" "noreturn"
    "type" "anyerror" "anyframe" "anytype" "comptime_int" "comptime_float" "anyopaque" "isize"
    "usize" "f16" "f32" "f64" "f80" "f128" "c_char" "c_short"
    "c_ushort" "c_int" "c_uint" "c_long" "c_ulong" "c_longlong" "c_ulonglong" "c_longdouble"
    "true" "false" "null" "unreachable" "undefined" "c" "_" "asm"
    "test" "error" "pub" "inline" "noinline" "extern" "comptime" "packed"
    "threadlocal" "volatile" "allowzero" "noalias" "addrspace" "align" "callconv" "linksection"
  )

  (bitset $ZigBits $ZigWord $mem.zigBits
    (declaration "fn" "const" "var" "struct" "enum" "union" "opaque")
    (control
      "if" "else" "switch" "for" "while" "break" "continue" "return"
      "defer" "errdefer" "try" "catch" "suspend" "nosuspend" "resume")
    (import "export")
    (wordOperator "and" "or" "orelse")
    (typeBuiltin
      "bool" "void" "noreturn" "type" "anyerror" "anyframe" "anytype"
      "comptime_int" "comptime_float" "anyopaque" "isize" "usize"
      "f16" "f32" "f64" "f80" "f128" "c_char" "c_short" "c_ushort"
      "c_int" "c_uint" "c_long" "c_ulong" "c_longlong" "c_ulonglong" "c_longdouble")
    (boolean "true" "false")
    (constantBuiltin "null" "unreachable" "undefined")
    (variableSpecial "c" "_")
  )

  ;; 78 sixteen-byte records, then a 128-slot open-addressed hash. Each
  ;; record is length, enum id, and up to 14 exact bytes.
  (data (i32.const $mem.zigWords)
    "\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\02\01\66\6e\00\00\00\00\00\00\00\00\00\00\00\00\05\02\63\6f\6e\73\74\00\00\00\00\00\00\00\00\00\03\03\76\61\72\00\00\00\00\00\00\00\00\00\00\00\06\04\73\74\72\75\63\74\00\00\00\00\00\00\00\00\04\05\65\6e\75\6d\00\00\00\00\00\00\00\00\00\00\05\06\75\6e\69\6f\6e\00\00\00\00\00\00\00\00\00\06\07\6f\70\61\71\75\65\00\00\00\00\00\00\00\00\02\08\69\66\00\00\00\00\00\00\00\00\00\00\00\00\04\09\65\6c\73\65\00\00\00\00\00\00\00\00\00\00\06\0a\73\77\69\74\63\68\00\00\00\00\00\00\00\00\03\0b\66\6f\72\00\00\00\00\00\00\00\00\00\00\00\05\0c\77\68\69\6c\65\00\00\00\00\00\00\00\00\00\05\0d\62\72\65\61\6b\00\00\00\00\00\00\00\00\00\08\0e\63\6f\6e\74\69\6e\75\65\00\00\00\00\00\00\06\0f\72\65\74\75\72\6e\00\00\00\00\00\00\00\00"
    "\05\10\64\65\66\65\72\00\00\00\00\00\00\00\00\00\08\11\65\72\72\64\65\66\65\72\00\00\00\00\00\00\03\12\74\72\79\00\00\00\00\00\00\00\00\00\00\00\05\13\63\61\74\63\68\00\00\00\00\00\00\00\00\00\07\14\73\75\73\70\65\6e\64\00\00\00\00\00\00\00\09\15\6e\6f\73\75\73\70\65\6e\64\00\00\00\00\00\06\16\72\65\73\75\6d\65\00\00\00\00\00\00\00\00\06\17\65\78\70\6f\72\74\00\00\00\00\00\00\00\00\03\18\61\6e\64\00\00\00\00\00\00\00\00\00\00\00\02\19\6f\72\00\00\00\00\00\00\00\00\00\00\00\00\06\1a\6f\72\65\6c\73\65\00\00\00\00\00\00\00\00\04\1b\62\6f\6f\6c\00\00\00\00\00\00\00\00\00\00\04\1c\76\6f\69\64\00\00\00\00\00\00\00\00\00\00\08\1d\6e\6f\72\65\74\75\72\6e\00\00\00\00\00\00\04\1e\74\79\70\65\00\00\00\00\00\00\00\00\00\00\08\1f\61\6e\79\65\72\72\6f\72\00\00\00\00\00\00"
    "\08\20\61\6e\79\66\72\61\6d\65\00\00\00\00\00\00\07\21\61\6e\79\74\79\70\65\00\00\00\00\00\00\00\0c\22\63\6f\6d\70\74\69\6d\65\5f\69\6e\74\00\00\0e\23\63\6f\6d\70\74\69\6d\65\5f\66\6c\6f\61\74\09\24\61\6e\79\6f\70\61\71\75\65\00\00\00\00\00\05\25\69\73\69\7a\65\00\00\00\00\00\00\00\00\00\05\26\75\73\69\7a\65\00\00\00\00\00\00\00\00\00\03\27\66\31\36\00\00\00\00\00\00\00\00\00\00\00\03\28\66\33\32\00\00\00\00\00\00\00\00\00\00\00\03\29\66\36\34\00\00\00\00\00\00\00\00\00\00\00\03\2a\66\38\30\00\00\00\00\00\00\00\00\00\00\00\04\2b\66\31\32\38\00\00\00\00\00\00\00\00\00\00\06\2c\63\5f\63\68\61\72\00\00\00\00\00\00\00\00\07\2d\63\5f\73\68\6f\72\74\00\00\00\00\00\00\00\08\2e\63\5f\75\73\68\6f\72\74\00\00\00\00\00\00\05\2f\63\5f\69\6e\74\00\00\00\00\00\00\00\00\00"
    "\06\30\63\5f\75\69\6e\74\00\00\00\00\00\00\00\00\06\31\63\5f\6c\6f\6e\67\00\00\00\00\00\00\00\00\07\32\63\5f\75\6c\6f\6e\67\00\00\00\00\00\00\00\0a\33\63\5f\6c\6f\6e\67\6c\6f\6e\67\00\00\00\00\0b\34\63\5f\75\6c\6f\6e\67\6c\6f\6e\67\00\00\00\0c\35\63\5f\6c\6f\6e\67\64\6f\75\62\6c\65\00\00\04\36\74\72\75\65\00\00\00\00\00\00\00\00\00\00\05\37\66\61\6c\73\65\00\00\00\00\00\00\00\00\00\04\38\6e\75\6c\6c\00\00\00\00\00\00\00\00\00\00\0b\39\75\6e\72\65\61\63\68\61\62\6c\65\00\00\00\09\3a\75\6e\64\65\66\69\6e\65\64\00\00\00\00\00\01\3b\63\00\00\00\00\00\00\00\00\00\00\00\00\00\01\3c\5f\00\00\00\00\00\00\00\00\00\00\00\00\00\03\3d\61\73\6d\00\00\00\00\00\00\00\00\00\00\00\04\3e\74\65\73\74\00\00\00\00\00\00\00\00\00\00\05\3f\65\72\72\6f\72\00\00\00\00\00\00\00\00\00"
    "\03\40\70\75\62\00\00\00\00\00\00\00\00\00\00\00\06\41\69\6e\6c\69\6e\65\00\00\00\00\00\00\00\00\08\42\6e\6f\69\6e\6c\69\6e\65\00\00\00\00\00\00\06\43\65\78\74\65\72\6e\00\00\00\00\00\00\00\00\08\44\63\6f\6d\70\74\69\6d\65\00\00\00\00\00\00\06\45\70\61\63\6b\65\64\00\00\00\00\00\00\00\00\0b\46\74\68\72\65\61\64\6c\6f\63\61\6c\00\00\00\08\47\76\6f\6c\61\74\69\6c\65\00\00\00\00\00\00\09\48\61\6c\6c\6f\77\7a\65\72\6f\00\00\00\00\00\07\49\6e\6f\61\6c\69\61\73\00\00\00\00\00\00\00\09\4a\61\64\64\72\73\70\61\63\65\00\00\00\00\00\05\4b\61\6c\69\67\6e\00\00\00\00\00\00\00\00\00\08\4c\63\61\6c\6c\63\6f\6e\76\00\00\00\00\00\00\0b\4d\6c\69\6e\6b\73\65\63\74\69\6f\6e\00\00\00")
  (data (i32.const $mem.zigHash)
    "\44\15\07\2f\30\37\3e\45\4b\32\00\2b\00\3f\00\00\00\00\14\29\00\40\00\00\00\00\00\34\00\31\19\00\1b\00\47\00\00\43\00\39\00\00\00\00\00\17\06\0e\01\0c\1e\36\3a\11\41\00\00\18\00\4a\00\3b\23\00"
    "\35\38\00\00\00\00\1c\00\00\00\00\00\25\00\00\00\0f\00\00\00\13\00\05\00\24\28\3d\42\46\00\00\04\0d\03\00\0a\26\20\09\2c\00\0b\1a\33\00\16\27\3c\48\4d\21\49\02\1d\10\12\1f\22\4c\00\2d\2e\08\2a")

  (func $zigLookupWord (param $lhs i32) (param $rhs i32) (result i32)
    (local $hash i32)
    (local $mask i64)
    (local $n i32)
    (local $packed i64)
    (local $probes i32)
    (local $record i32)
    (local $rem i32)
    (local $word i32)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.gt_u (i32.sub (local.get $n) (i32.const 1)) (i32.const 13))
      (then (return (enum.get $ZigWord.invalid))))
    (local.set $hash
      (i32.and
        (i32.add
          (i32.add (local.get $n)
            (i32.shl (i32.load8_u (local.get $lhs)) (i32.const 1)))
          (i32.add
            (i32.mul (i32.load8_u (i32.sub (local.get $rhs) (i32.const 1))) (i32.const 11))
            (i32.add
              (i32.mul
                (select (i32.load8_u offset=1 (local.get $lhs)) (i32.const 0)
                  (i32.gt_u (local.get $n) (i32.const 1)))
                (i32.const 5))
              (i32.mul
                (i32.load8_u (i32.add (local.get $lhs)
                  (i32.shr_u (local.get $n) (i32.const 1))))
                (i32.const 7)))))
        (i32.const 127)))
    (local.set $probes (i32.const 13))
    (loop $probe
      (local.set $word
        (i32.load8_u (i32.add (i32.const $mem.zigHash) (local.get $hash))))
      (if (i32.eqz (local.get $word))
        (then (return (enum.get $ZigWord.invalid))))
      (local.set $record
        (i32.add (i32.const $mem.zigWords) (i32.shl (local.get $word) (i32.const 4))))
      (if (i32.eq (i32.load8_u (local.get $record)) (local.get $n))
        (then
          (if (i32.le_u (local.get $n) (i32.const 8))
            (then
              (local.set $mask (select
                (i64.const -1)
                (i64.sub
                  (i64.shl (i64.const 1)
                    (i64.extend_i32_u (i32.shl (local.get $n) (i32.const 3))))
                  (i64.const 1))
                (i32.eq (local.get $n) (i32.const 8))))
              (local.set $packed (i64.and (i64.load (local.get $lhs)) (local.get $mask)))
              (if (i64.eq (local.get $packed)
                    (i64.and (i64.load offset=2 (local.get $record)) (local.get $mask)))
                (then (return (local.get $word)))))
            (else
              (if (i64.eq (i64.load (local.get $lhs))
                    (i64.load offset=2 (local.get $record)))
                (then
                  (local.set $rem (i32.sub (local.get $n) (i32.const 8)))
                  (local.set $mask
                    (i64.sub
                      (i64.shl (i64.const 1)
                        (i64.extend_i32_u (i32.shl (local.get $rem) (i32.const 3))))
                      (i64.const 1)))
                  (if (i64.eq
                        (i64.and (i64.load offset=8 (local.get $lhs)) (local.get $mask))
                        (i64.and (i64.load offset=10 (local.get $record)) (local.get $mask)))
                    (then (return (local.get $word))))))))))
      (local.set $hash
        (i32.and (i32.add (local.get $hash) (i32.const 1)) (i32.const 127)))
      (local.set $probes (i32.sub (local.get $probes) (i32.const 1)))
      (br_if $probe (local.get $probes)))
    (enum.get $ZigWord.invalid))

  (func $zigWordHl (param $word i32) (param $lhs i32) (param $rhs i32) (result i32)
    (local $p i32)
    (local $width i32)
    ;; Arbitrary-width signed and unsigned integers are primitive types.
    (if (i32.eq (local.get $word) (enum.get $ZigWord.invalid))
      (then
        (if (i32.and
              (i32.gt_u (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 1))
              (i32.or
                (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "i"))
                (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "u"))))
          (then
            (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
            (block $notType
              (loop $digit
                (br_if $notType (i32.ge_u (local.get $p) (local.get $rhs)))
                (if (i32.eqz (call $lexIsDigit (i32.load8_u (local.get $p))))
                  (then (return (i32.const -1))))
                (if (i32.gt_u (local.get $width) (i32.const 6553))
                  (then (return (i32.const -1))))
                (local.set $width
                  (i32.add
                    (i32.mul (local.get $width) (i32.const 10))
                    (i32.sub (i32.load8_u (local.get $p)) (i32.const "0"))))
                (if (i32.gt_u (local.get $width) (i32.const 65535))
                  (then (return (i32.const -1))))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $digit)))
            (return (enum.get $Token.type.builtin))))
        (return (i32.const -1))))
    (if (bitset.get $ZigBits.declaration (local.get $word))
      (then
        (if (i32.eq (local.get $word) (enum.get $ZigWord.fn))
          (then (return
            (i32.or (enum.get $Token.keyword.declaration) (i32.const 256)))))
        (return (enum.get $Token.keyword.declaration))))
    (if (bitset.get $ZigBits.control (local.get $word))
      (then (return (enum.get $Token.keyword.control))))
    (if (bitset.get $ZigBits.import (local.get $word))
      (then (return (enum.get $Token.keyword.import))))
    (if (bitset.get $ZigBits.wordOperator (local.get $word))
      (then (return (enum.get $Token.keyword.operator))))
    (if (bitset.get $ZigBits.typeBuiltin (local.get $word))
      (then (return (enum.get $Token.type.builtin))))
    (if (bitset.get $ZigBits.boolean (local.get $word))
      (then (return (enum.get $Token.boolean))))
    (if (bitset.get $ZigBits.constantBuiltin (local.get $word))
      (then (return (enum.get $Token.constant.builtin))))
    (if (bitset.get $ZigBits.variableSpecial (local.get $word))
      (then (return (enum.get $Token.variable.special))))
    (enum.get $Token.keyword))

  (func $zigIsOp (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "+"))
                (i32.eq (local.get $c) (i32.const "-")))
        (i32.or (i32.eq (local.get $c) (i32.const "*"))
                (i32.eq (local.get $c) (i32.const "/"))))
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "%"))
                (i32.eq (local.get $c) (i32.const "=")))
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "!"))
                  (i32.eq (local.get $c) (i32.const "~")))
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const "<"))
                    (i32.eq (local.get $c) (i32.const ">")))
            (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "&"))
                      (i32.eq (local.get $c) (i32.const "|")))
              (i32.or (i32.eq (local.get $c) (i32.const "^"))
                      (i32.eq (local.get $c) (i32.const "?")))))))))

  (func $hlZig
    (local $base i32)
    (local $c i32)
    (local $expectFunc i32)
    (local $expectLabel i32)
    (local $expectType i32)
    (local $expectVar i32)
    (local $gap i32)
    (local $hl i32)
    (local $labelColon i32)
    (local $lhs i32)
    (local $p i32)
    (local $parenDepth i32)
    (local $payload i32)
    (local $payloadParens i64)
    (local $payloadReady i32)
    (local $prevDot i32)
    (local $q i32)
    (local $word i32)
    (local $wantBreakLabel i32)
    (local $wantPayloadParen i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $lexScanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $p (call $zigByte
          (i32.add (global.get $ptr) (i32.const 1))))

        ;; Context may cross whitespace and comments, but not another token.
        (if (i32.eqz (i32.and
              (i32.eq (local.get $c) (i32.const "/"))
              (i32.eq (local.get $p) (i32.const "/"))))
          (then
            (if (i32.and (local.get $wantBreakLabel)
                  (i32.ne (local.get $c) (i32.const ":")))
              (then (local.set $wantBreakLabel (i32.const 0))))
            (if (i32.and (local.get $labelColon)
                  (i32.ne (local.get $c) (i32.const ":")))
              (then (local.set $labelColon (i32.const 0))))
            (if (i32.and
                  (i32.or (local.get $expectFunc) (local.get $expectLabel))
                  (i32.eqz (i32.or
                    (call $zigIsIdentStart (local.get $c))
                    (i32.and
                      (i32.eq (local.get $c) (i32.const "@"))
                      (i32.eq (local.get $p) (i32.const 34))))))
              (then
                (local.set $expectFunc (i32.const 0))
                (local.set $expectLabel (i32.const 0))))
            (if (i32.and (local.get $wantPayloadParen)
                  (i32.ne (local.get $c) (i32.const "(")))
              (then (local.set $wantPayloadParen (i32.const 0))))
            (if (i32.and (local.get $payloadReady)
                  (i32.eqz (i32.and
                    (i32.eq (local.get $c) (i32.const "|"))
                    (i32.and
                      (i32.ne (local.get $p) (i32.const "|"))
                      (i32.ne (local.get $p) (i32.const "="))))))
              (then (local.set $payloadReady (i32.const 0))))))

        ;; Zig has only line comments. `///` and `//!` are documentation;
        ;; `////` starts an ordinary line comment.
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "/"))
              (i32.eq (local.get $p) (i32.const "/")))
          (then
            (local.set $hl (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.or
                (i32.eq (call $zigByte
                  (i32.add (global.get $ptr) (i32.const 2))) (i32.const "!"))
                (i32.and
                  (i32.eq (call $zigByte
                    (i32.add (global.get $ptr) (i32.const 2))) (i32.const "/"))
                  (i32.ne (call $zigByte
                    (i32.add (global.get $ptr) (i32.const 3))) (i32.const "/"))))))
            (call $lexLineComment (i32.const 2) (local.get $hl))
            (br $next)))

        ;; Each `\\` line is one segment of a raw multiline string.
        (if (i32.and
              (i32.eq (local.get $c) (i32.const 92))
              (i32.eq (local.get $p) (i32.const 92)))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.string))
            (local.set $prevDot (i32.const 0))
            (br $next)))

        (if (i32.or
              (i32.eq (local.get $c) (i32.const 34))
              (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $zigString (local.get $c) (enum.get $Token.string))
            (local.set $prevDot (i32.const 0))
            (local.set $expectType (i32.const 0))
            (br $next)))

        ;; Quoted identifiers keep declaration, label, and member context.
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "@"))
              (i32.eq (local.get $p) (i32.const 34)))
          (then
            (local.set $hl (enum.get $Token.variable))
            (if (local.get $expectFunc)
              (then (local.set $hl (enum.get $Token.function.definition))))
            (if (local.get $expectLabel)
              (then (local.set $hl (enum.get $Token.label))))
            (if (local.get $expectType)
              (then (local.set $hl (enum.get $Token.type))))
            (if (local.get $prevDot)
              (then (local.set $hl (enum.get $Token.property))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (call $zigString (i32.const 34) (local.get $hl))
            (local.set $expectFunc (i32.const 0))
            (local.set $expectLabel (i32.const 0))
            (local.set $expectType (i32.const 0))
            (local.set $expectVar (i32.const 0))
            (local.set $prevDot (i32.const 0))
            (br $next)))

        ;; Builtin identifiers are functions, except import primitives.
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "@"))
              (call $zigIsIdentStart (local.get $p)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (global.set $ptr (call $zigIdentEnd (global.get $ptr)))
            (local.set $hl (enum.get $Token.function))
            (if (i32.or
                  (i32.and
                    (i32.eq
                      (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 7))
                    (i64.eq
                      (i64.and
                        (i64.load (local.get $lhs)) (i64.const 0x00ffffffffffffff))
                      (i64.const "@import")))
                  (i32.and
                    (i32.eq
                      (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 8))
                    (i64.eq (i64.load (local.get $lhs)) (i64.const "@cImport"))))
              (then (local.set $hl (enum.get $Token.keyword.import))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (local.set $expectType (i32.const 0))
            (local.set $prevDot (i32.const 0))
            (br $next)))

        (if (call $lexIsDigit (local.get $c))
          (then
            (local.set $base (i32.const 10))
            (if (i32.eq (local.get $c) (i32.const "0"))
              (then
                (local.set $c
                  (call $zigByte (i32.add (local.get $lhs) (i32.const 1))))
                (if (i32.eq (local.get $c) (i32.const "b"))
                  (then (local.set $base (i32.const 2))))
                (if (i32.eq (local.get $c) (i32.const "o"))
                  (then (local.set $base (i32.const 8))))
                (if (i32.eq (local.get $c) (i32.const "x"))
                  (then (local.set $base (i32.const 16))))))
            (if (i32.and
                  (i32.ne (local.get $base) (i32.const 10))
                  (call $zigIsDigitForBase
                    (call $zigByte (i32.add (local.get $lhs) (i32.const 2)))
                    (local.get $base)))
              (then
                (global.set $ptr
                  (call $zigScanDigits
                    (i32.add (local.get $lhs) (i32.const 2)) (local.get $base))))
              (else
                (local.set $base (i32.const 10))
                (global.set $ptr
                  (call $zigScanDigits (local.get $lhs) (i32.const 10)))))
            (if (i32.and
                  (i32.or
                    (i32.eq (local.get $base) (i32.const 10))
                    (i32.eq (local.get $base) (i32.const 16)))
                  (i32.and
                    (i32.eq (call $zigByte (global.get $ptr)) (i32.const "."))
                    (call $zigIsDigitForBase
                      (call $zigByte
                        (i32.add (global.get $ptr) (i32.const 1)))
                      (local.get $base))))
              (then
                (global.set $ptr
                  (call $zigScanDigits
                    (i32.add (global.get $ptr) (i32.const 1))
                    (local.get $base)))))
            (local.set $c
              (i32.or (call $zigByte (global.get $ptr)) (i32.const 32)))
            (if (i32.or
                  (i32.and
                    (i32.eq (local.get $base) (i32.const 10))
                    (i32.eq (local.get $c) (i32.const "e")))
                  (i32.and
                    (i32.eq (local.get $base) (i32.const 16))
                    (i32.eq (local.get $c) (i32.const "p"))))
              (then
                (local.set $p (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.or
                      (i32.eq (call $zigByte (local.get $p)) (i32.const "+"))
                      (i32.eq (call $zigByte (local.get $p)) (i32.const "-")))
                  (then
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))))
                (if (call $lexIsDigit (call $zigByte (local.get $p)))
                  (then
                    (global.set $ptr
                      (call $zigScanDigits (local.get $p) (i32.const 10)))))))
            (call $emitTok
              (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $prevDot (i32.const 0))
            (local.set $expectType (i32.const 0))
            (br $next)))

        (if (call $zigIsIdentStart (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (global.set $ptr (call $zigIdentEnd (global.get $ptr)))
            (local.set $word
              (call $zigLookupWord (local.get $lhs) (global.get $ptr)))
            (local.set $hl
              (call $zigWordHl (local.get $word) (local.get $lhs) (global.get $ptr)))
            (if (i32.ge_s (local.get $hl) (i32.const 0))
              (then
                (if (i32.and (local.get $hl) (i32.const 256))
                  (then (local.set $expectFunc (i32.const 1))))
                (local.set $hl (i32.and (local.get $hl) (i32.const 255)))
                (if (i32.or
                      (i32.eq (local.get $word) (enum.get $ZigWord.break))
                      (i32.eq (local.get $word) (enum.get $ZigWord.continue)))
                  (then (local.set $wantBreakLabel (i32.const 1))))
                (if (i32.or
                      (i32.eq (local.get $word) (enum.get $ZigWord.const))
                      (i32.eq (local.get $word) (enum.get $ZigWord.var)))
                  (then (local.set $expectVar (i32.const 1))))
                (if (i32.or
                      (i32.eq (local.get $word) (enum.get $ZigWord.if))
                      (i32.or
                        (i32.eq (local.get $word) (enum.get $ZigWord.while))
                        (i32.eq (local.get $word) (enum.get $ZigWord.for))))
                  (then (local.set $wantPayloadParen (i32.const 1))))
                (if (i32.or
                      (i32.eq (local.get $word) (enum.get $ZigWord.catch))
                      (i32.or
                        (i32.eq (local.get $word) (enum.get $ZigWord.else))
                        (i32.eq (local.get $word) (enum.get $ZigWord.errdefer))))
                  (then (local.set $payloadReady (i32.const 1))))
                (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
                (local.set $prevDot (i32.const 0))
                (if (i32.or
                      (i32.eq (local.get $hl) (enum.get $Token.type.builtin))
                      (i32.eq (local.get $hl) (enum.get $Token.constant.builtin)))
                  (then (local.set $expectType (i32.const 0))))
                (br $next)))

            (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
            (local.set $hl (enum.get $Token.variable))
            (if (local.get $expectFunc)
              (then (local.set $hl (enum.get $Token.function.definition))))
            (if (local.get $expectLabel)
              (then (local.set $hl (enum.get $Token.label))))
            (if (local.get $expectType)
              (then (local.set $hl (enum.get $Token.type))))
            (if (local.get $prevDot)
              (then
                (local.set $hl (select
                  (enum.get $Token.function.method) (enum.get $Token.property)
                  (i32.eq (call $zigByte (local.get $p)) (i32.const "("))))))
            (if (i32.and
                  (i32.eq (local.get $hl) (enum.get $Token.variable))
                  (i32.eq (call $zigByte (local.get $p)) (i32.const "(")))
              (then (local.set $hl (enum.get $Token.function))))
            (if (i32.and
                  (i32.eq (local.get $hl) (enum.get $Token.variable))
                  (i32.le_u
                    (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A"))
                    (i32.const 25)))
              (then
                (local.set $hl (select
                  (enum.get $Token.constant) (enum.get $Token.type)
                  (call $lexIsConstCase (local.get $lhs) (global.get $ptr))))))

            ;; Container fields are properties; block/loop prefixes are labels.
            (if (i32.and
                  (i32.eqz (local.get $expectVar))
                  (i32.eq (call $zigByte (local.get $p)) (i32.const ":")))
              (then
                (local.set $q
                  (call $lexSkipSpaceAt (i32.add (local.get $p) (i32.const 1))))
                (local.set $base (i32.const 0))
                (local.set $word (enum.get $ZigWord.invalid))
                (if (call $zigIsIdentStart (call $zigByte (local.get $q)))
                  (then
                    (local.set $p (call $zigIdentEnd (local.get $q)))
                    (local.set $word
                      (call $zigLookupWord (local.get $q) (local.get $p)))
                    (if (i32.eq (local.get $word) (enum.get $ZigWord.inline))
                      (then
                        (local.set $base (i32.const 1))
                        (local.set $q (call $lexSkipSpaceAt (local.get $p)))
                        (if (call $zigIsIdentStart (call $zigByte (local.get $q)))
                          (then
                            (local.set $p (call $zigIdentEnd (local.get $q)))
                            (local.set $word
                              (call $zigLookupWord
                                (local.get $q) (local.get $p)))))))))
                (if (i32.and (i32.eqz (local.get $parenDepth))
                      (i32.or
                        (i32.eq (call $zigByte (local.get $q)) (i32.const "{"))
                        (i32.or
                          (i32.eq (local.get $word) (enum.get $ZigWord.for))
                          (i32.or
                            (i32.eq (local.get $word) (enum.get $ZigWord.while))
                            (i32.and
                              (i32.eqz (local.get $base))
                              (i32.eq
                                (local.get $word) (enum.get $ZigWord.switch)))))))
                  (then
                    (local.set $hl (enum.get $Token.label))
                    (local.set $labelColon (i32.const 1)))
                  (else
                    (if (i32.eqz (local.get $parenDepth))
                      (then (local.set $hl (enum.get $Token.property))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (local.set $expectFunc (i32.const 0))
            (local.set $expectLabel (i32.const 0))
            (local.set $expectType (i32.const 0))
            (local.set $expectVar (i32.const 0))
            (local.set $prevDot (i32.const 0))
            (br $next)))

        (if (i32.or
              (i32.or
                (i32.eq (local.get $c) (i32.const "("))
                (i32.eq (local.get $c) (i32.const ")")))
              (i32.or
                (i32.or
                  (i32.eq (local.get $c) (i32.const "["))
                  (i32.eq (local.get $c) (i32.const "]")))
                (i32.or
                  (i32.eq (local.get $c) (i32.const "{"))
                  (i32.eq (local.get $c) (i32.const "}")))))
          (then
            (if (i32.eq (local.get $c) (i32.const "("))
              (then
                (local.set $parenDepth
                  (i32.add (local.get $parenDepth) (i32.const 1)))
                (if (local.get $wantPayloadParen)
                  (then
                    (local.set $payloadParens
                      (i64.or
                        (local.get $payloadParens)
                        (i64.shl
                          (i64.const 1)
                          (i64.extend_i32_u (local.get $parenDepth)))))))
                (local.set $wantPayloadParen (i32.const 0))
                (local.set $expectFunc (i32.const 0))))
            (if (i32.and
                  (i32.eq (local.get $c) (i32.const ")"))
                  (i32.ne (local.get $parenDepth) (i32.const 0)))
              (then
                (local.set $payloadReady
                  (i32.wrap_i64 (i64.and
                    (i64.shr_u
                      (local.get $payloadParens)
                      (i64.extend_i32_u (local.get $parenDepth)))
                    (i64.const 1))))
                (local.set $payloadParens
                  (i64.and
                    (local.get $payloadParens)
                    (i64.xor
                      (i64.shl
                        (i64.const 1)
                        (i64.extend_i32_u (local.get $parenDepth)))
                      (i64.const -1))))
                (local.set $parenDepth
                  (i32.sub (local.get $parenDepth) (i32.const 1)))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $prevDot (i32.const 0))
            (br $next)))

        ;; Arrows are delimiters in Zig's highlight query.
        (if (i32.or
              (i32.and
                (i32.eq (local.get $c) (i32.const "="))
                (i32.eq (local.get $p) (i32.const ">")))
              (i32.and
                (i32.eq (local.get $c) (i32.const "-"))
                (i32.eq (local.get $p) (i32.const ">"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (if (i32.eq (local.get $c) (i32.const "="))
              (then (local.set $payloadReady (i32.const 1))))
            (local.set $prevDot (i32.const 0))
            (br $next)))

        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            ;; $zigByte reads as 0 at or past $end, so matching a printable
            ;; byte there proves it is inside the range: both advances below
            ;; land at or before $end and need no clamp.
            (if (i32.and
                  (i32.eq (local.get $p) (i32.const "."))
                  (i32.eq (call $zigByte (i32.add (global.get $ptr) (i32.const 2)))
                          (i32.const ".")))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
                (call $emitTok
                  (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
                (local.set $prevDot (i32.const 0))
                (br $next)))
            (if (i32.or
                  (i32.eq (local.get $p) (i32.const "."))
                  (i32.or
                    (i32.eq (local.get $p) (i32.const "*"))
                    (i32.eq (local.get $p) (i32.const "?"))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (call $emitTok
                  (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (local.set $prevDot (i32.const 0))
                (br $next)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $prevDot (i32.const 1))
            (br $next)))

        (if (i32.or
              (i32.eq (local.get $c) (i32.const ";"))
              (i32.or (i32.eq (local.get $c) (i32.const ","))
                      (i32.eq (local.get $c) (i32.const ":"))))
          (then
            (if (i32.eq (local.get $c) (i32.const ":"))
              (then
                (if (local.get $wantBreakLabel)
                  (then
                    (local.set $expectLabel (i32.const 1))
                    (local.set $wantBreakLabel (i32.const 0)))
                  (else
                    (if (i32.eqz (local.get $labelColon))
                      (then (local.set $expectType (i32.const 1))))))))
            (local.set $labelColon (i32.const 0))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $prevDot (i32.const 0))
            (br $next)))

        ;; Payload captures use bracket-colored bars, unlike bitwise operators.
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "|"))
              (i32.or
                (local.get $payload)
                (i32.and
                  (local.get $payloadReady)
                  (i32.and
                    (i32.ne (local.get $p) (i32.const "|"))
                    (i32.ne (local.get $p) (i32.const "="))))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $payload (i32.eqz (local.get $payload)))
            (local.set $payloadReady (i32.const 0))
            (local.set $prevDot (i32.const 0))
            (br $next)))

        (if (call $zigIsOp (local.get $c))
          (then
            (block $opDone
              (loop $op
                (local.set $c (i32.load8_u (global.get $ptr)))
                (local.set $p
                  (call $zigByte (i32.add (global.get $ptr) (i32.const 1))))
                (br_if $opDone (i32.or
                  (i32.and
                    (i32.or
                      (i32.eq (local.get $c) (i32.const "-"))
                      (i32.eq (local.get $c) (i32.const "=")))
                    (i32.eq (local.get $p) (i32.const ">")))
                  (i32.and
                    (i32.eq (local.get $c) (i32.const "/"))
                    (i32.eq (local.get $p) (i32.const "/")))))
                (local.set $q
                  (call $zigByte (i32.add (global.get $ptr) (i32.const 2))))
                (local.set $base (i32.const 1))
                (if (i32.and
                      (i32.eq (local.get $p) (i32.const "="))
                      (i32.and
                        (i32.ne (local.get $c) (i32.const "?"))
                        (i32.ne (local.get $c) (i32.const "~"))))
                  (then (local.set $base (i32.const 2))))
                (if (i32.or
                      (i32.and
                        (i32.eq (local.get $c) (i32.const "*"))
                        (i32.eq (local.get $p) (i32.const "*")))
                      (i32.or
                        (i32.and
                          (i32.eq (local.get $c) (i32.const "+"))
                          (i32.eq (local.get $p) (i32.const "+")))
                        (i32.and
                          (i32.eq (local.get $c) (i32.const "|"))
                          (i32.eq (local.get $p) (i32.const "|")))))
                  (then (local.set $base (i32.const 2))))
                (if (i32.and
                      (i32.or
                        (i32.eq (local.get $c) (i32.const "*"))
                        (i32.or
                          (i32.eq (local.get $c) (i32.const "+"))
                          (i32.eq (local.get $c) (i32.const "-"))))
                      (i32.or
                        (i32.eq (local.get $p) (i32.const "%"))
                        (i32.eq (local.get $p) (i32.const "|"))))
                  (then
                    (local.set $base
                      (select (i32.const 3) (i32.const 2)
                        (i32.eq (local.get $q) (i32.const "="))))))
                (if (i32.and
                      (i32.eq (local.get $c) (i32.const "<"))
                      (i32.eq (local.get $p) (i32.const "<")))
                  (then
                    (local.set $base (i32.const 2))
                    (if (i32.eq (local.get $q) (i32.const "="))
                      (then (local.set $base (i32.const 3))))
                    (if (i32.eq (local.get $q) (i32.const "|"))
                      (then
                        (local.set $base (select
                          (i32.const 4) (i32.const 3)
                          (i32.eq
                            (call $zigByte
                              (i32.add (global.get $ptr) (i32.const 3)))
                            (i32.const "="))))))))
                (if (i32.and
                      (i32.eq (local.get $c) (i32.const ">"))
                      (i32.eq (local.get $p) (i32.const ">")))
                  (then
                    (local.set $base
                      (select (i32.const 3) (i32.const 2)
                        (i32.eq (local.get $q) (i32.const "="))))))
                (global.set $ptr
                  (i32.add (global.get $ptr) (local.get $base)))
                (br_if $op (i32.and
                  (i32.lt_u (global.get $ptr) (global.get $end))
                  (call $zigIsOp (i32.load8_u (global.get $ptr)))))))
            (call $emitTok
              (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $prevDot (i32.const 0))
            (br $next)))

        ;; Invalid bytes remain lossless and always advance.
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $prevDot (i32.const 0))
        (br $next))))
)
