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

  ;; End of the ASCII identifier run [A-Za-z0-9_] starting at $p - 16 bytes
  ;; per step, clamped to $end. Zig identifiers are ASCII, so unlike
  ;; $scanIdentRun this stops at bytes >= 0x80 instead of absorbing a UTF-8
  ;; sequence into the name.
  (func $zigIdentEnd (param $p i32) (result i32)
    (local $mask i32)
    (local $w v128)
    (block $done
      (loop $wide
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $w (v128.load (local.get $p)))
        (local.set $mask (i32.xor
          (i8x16.bitmask (v128.or
            (i8x16.le_u
              (i8x16.sub
                (v128.or (local.get $w) (i8x16.splat (i32.const 32)))
                (i8x16.splat (i32.const "a")))
              (i8x16.splat (i32.const 25)))
            (v128.or
              (i8x16.le_u
                (i8x16.sub (local.get $w) (i8x16.splat (i32.const "0")))
                (i8x16.splat (i32.const 9)))
              (i8x16.eq (local.get $w) (i8x16.splat (i32.const "_"))))))
          (i32.const 65535)))
        (if (local.get $mask)
          (then
            (local.set $p (i32.add (local.get $p) (i32.ctz (local.get $mask))))
            (br $done)))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br $wide)))
    (if (i32.gt_u (local.get $p) (global.get $end))
      (then (local.set $p (global.get $end))))
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

  ;; Group order is the dispatch order in $zigWordHl below; the groups that
  ;; also drive lexer context are checked by number in $hlZig. `comptime` is
  ;; absent on purpose: the table hash sees only the first two bytes, the last
  ;; byte, and the length, which are identical for `continue`, so the two
  ;; words can never share a table and `comptime` is matched directly. The
  ;; one-byte names `c` and `_` are below the table's minimum length and are
  ;; matched directly too.
  (keyword-table $zigWords $mem.zigWords $mem.zigWords+896 32 128
    (group "fn") ;; 1: declaration, next name is a function
    (group "const" "var") ;; 2: declaration, next name is a variable
    (group "struct" "enum" "union" "opaque") ;; 3: declaration
    (group "if") ;; 4: control, a payload paren may follow
    (group "for" "while") ;; 5: control, payload paren, label target
    (group "switch") ;; 6: control, label target unless inline
    (group "break" "continue") ;; 7: control, a label may follow
    (group "else" "catch" "errdefer") ;; 8: control, payload bars may follow
    (group ;; 9: control
      "return" "defer" "try" "suspend" "nosuspend" "resume")
    (group "export") ;; 10: import
    (group "and" "or" "orelse") ;; 11: word operators
    (group ;; 12: primitive types
      "bool" "void" "noreturn" "type" "anyerror" "anyframe" "anytype"
      "comptime_int" "comptime_float" "anyopaque" "isize" "usize"
      "f16" "f32" "f64" "f80" "f128" "c_char" "c_short" "c_ushort"
      "c_int" "c_uint" "c_long" "c_ulong" "c_longlong" "c_ulonglong"
      "c_longdouble")
    (group "true" "false") ;; 13: booleans
    (group "null" "unreachable" "undefined") ;; 14: builtin constants
    (group "inline") ;; 15: keyword, may prefix a labeled loop
    (group ;; 16: keywords
      "asm" "test" "error" "pub" "noinline" "extern" "packed" "threadlocal"
      "volatile" "allowzero" "noalias" "addrspace" "align" "callconv"
      "linksection"))

  ;; Classify the name [lhs,rhs): the token in the low byte and the table
  ;; group in the high byte, or -1 for a plain name. Arbitrary-width `iN` and
  ;; `uN` names are primitive types.
  (func $zigWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $g i32)
    (local $p i32)
    (local $width i32)
    (local.set $g (keyword-table.get $zigWords (local.get $lhs) (local.get $rhs)))
    (if (i32.eqz (local.get $g))
      (then
        (if (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 1))
          (then
            (if (i32.or
                  (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "c"))
                  (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "_")))
              (then (return (enum.get $Token.variable.special))))
            (return (i32.const -1))))
        ;; the one word the table cannot hold; the wide load stays inside the
        ;; input slack, as in the table's own compare
        (if (i32.and
              (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 8))
              (i64.eq (i64.load (local.get $lhs)) (i64.const "comptime")))
          (then (return (enum.get $Token.keyword))))
        (if (i32.or
              (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "i"))
              (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "u")))
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
    (if (i32.le_u (local.get $g) (i32.const 3))
      (then (return (i32.or (enum.get $Token.keyword.declaration)
        (i32.shl (local.get $g) (i32.const 8))))))
    (if (i32.le_u (local.get $g) (i32.const 9))
      (then (return (i32.or (enum.get $Token.keyword.control)
        (i32.shl (local.get $g) (i32.const 8))))))
    (if (i32.eq (local.get $g) (i32.const 10))
      (then (return (enum.get $Token.keyword.import))))
    (if (i32.eq (local.get $g) (i32.const 11))
      (then (return (enum.get $Token.keyword.operator))))
    (if (i32.eq (local.get $g) (i32.const 12))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.eq (local.get $g) (i32.const 13))
      (then (return (enum.get $Token.boolean))))
    (if (i32.eq (local.get $g) (i32.const 14))
      (then (return (enum.get $Token.constant.builtin))))
    (i32.or (enum.get $Token.keyword) (i32.shl (local.get $g) (i32.const 8))))

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
        (call $scanWhitespace)
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
            ;; an armed fn head expects its parameter paren immediately
            (if (i32.and (global.get $sigFnPend)
                  (i32.ne (local.get $c) (i32.const "(")))
              (then (global.set $sigFnPend (i32.const 0))))
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
              (then
                (local.set $hl (enum.get $Token.function.definition))
                ;; a quoted fn name arms the parameter machine too
                (global.set $sigFnPend (i32.const 1))))
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
            (local.set $hl
              (call $zigWordHl (local.get $lhs) (global.get $ptr)))
            (if (i32.ge_s (local.get $hl) (i32.const 0))
              (then
                ;; the table group rides in the high byte, see $zigWordHl
                (local.set $word (i32.shr_u (local.get $hl) (i32.const 8)))
                (local.set $hl (i32.and (local.get $hl) (i32.const 255)))
                (if (i32.eq (local.get $word) (i32.const 1))
                  (then (local.set $expectFunc (i32.const 1))))
                (if (i32.eq (local.get $word) (i32.const 2))
                  (then (local.set $expectVar (i32.const 1))))
                (if (i32.or
                      (i32.eq (local.get $word) (i32.const 4))
                      (i32.eq (local.get $word) (i32.const 5)))
                  (then (local.set $wantPayloadParen (i32.const 1))))
                (if (i32.eq (local.get $word) (i32.const 7))
                  (then (local.set $wantBreakLabel (i32.const 1))))
                (if (i32.eq (local.get $word) (i32.const 8))
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
              (then
                (local.set $hl (enum.get $Token.function.definition))
                ;; an fn name arms the parameter machine for its paren
                (global.set $sigFnPend (i32.const 1))))
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
            ;; A `const` inside a preceding type (`[]const u8`) sets
            ;; $expectVar, so a marked parameter list overrides that gate.
            (if (i32.and
                  (i32.or (i32.eqz (local.get $expectVar)) (call $sigActive))
                  (i32.eq (call $zigByte (local.get $p)) (i32.const ":")))
              (then
                (local.set $q
                  (call $lexSkipSpaceAt (i32.add (local.get $p) (i32.const 1))))
                (local.set $base (i32.const 0))
                (local.set $word (i32.const 0))
                ;; only a top-level `name:` can be a label, so the lookahead
                ;; for its loop keyword is skipped inside parameter lists
                (if (i32.and
                      (i32.eqz (local.get $parenDepth))
                      (call $zigIsIdentStart (call $zigByte (local.get $q))))
                  (then
                    (local.set $p (call $zigIdentEnd (local.get $q)))
                    (local.set $word
                      (keyword-table.get $zigWords (local.get $q) (local.get $p)))
                    (if (i32.eq (local.get $word) (i32.const 15))
                      (then
                        (local.set $base (i32.const 1))
                        (local.set $q (call $lexSkipSpaceAt (local.get $p)))
                        (if (call $zigIsIdentStart (call $zigByte (local.get $q)))
                          (then
                            (local.set $p (call $zigIdentEnd (local.get $q)))
                            (local.set $word
                              (keyword-table.get $zigWords
                                (local.get $q) (local.get $p)))))))))
                (if (i32.and (i32.eqz (local.get $parenDepth))
                      (i32.or
                        (i32.eq (call $zigByte (local.get $q)) (i32.const "{"))
                        (i32.or
                          (i32.eq (local.get $word) (i32.const 5))
                          (i32.and
                            (i32.eqz (local.get $base))
                            (i32.eq (local.get $word) (i32.const 6))))))
                  (then
                    (local.set $hl (enum.get $Token.label))
                    (local.set $labelColon (i32.const 1)))
                  (else
                    (if (i32.eqz (local.get $parenDepth))
                      (then (local.set $hl (enum.get $Token.property)))
                      (else
                        ;; an annotated name at the top level of a marked fn
                        ;; list is a parameter (Zed's parameter name capture)
                        (if (i32.and
                              (i32.and (call $sigActive) (global.get $sigPattern))
                              (i32.eqz (global.get $sigObscure)))
                          (then (local.set $hl (enum.get $Token.variable.parameter))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (local.set $expectFunc (i32.const 0))
            (local.set $expectLabel (i32.const 0))
            (local.set $expectType (i32.const 0))
            (local.set $expectVar (i32.const 0))
            (local.set $prevDot (i32.const 0))
            ;; a name consumes parameter position; keyword modifiers such as
            ;; `comptime` take the keyword path above and leave it alone
            (global.set $sigPattern (i32.const 0))
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
                (local.set $expectFunc (i32.const 0))
                ;; parameter machine: the paren may open the armed fn list
                ;; and puts the next name in parameter position
                (global.set $sigParens
                  (i32.add (global.get $sigParens) (i32.const 1)))
                (if (global.get $sigFnPend) (then (call $sigMark)))
                (global.set $sigFnPend (i32.const 0))
                (global.set $sigPattern (i32.const 1))))
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
            (if (i32.ne (local.get $c) (i32.const "("))
              (then
                (global.set $sigPattern (i32.const 0))
                (if (i32.eq (local.get $c) (i32.const ")"))
                  (then
                    (if (call $sigActive) (then (call $sigUnmark)))
                    (if (i32.gt_u (global.get $sigParens) (i32.const 0))
                      (then (global.set $sigParens
                        (i32.sub (global.get $sigParens) (i32.const 1))))))
                  (else
                    (if (call $sigActive)
                      (then
                        (if (i32.or
                              (i32.eq (local.get $c) (i32.const "["))
                              (i32.eq (local.get $c) (i32.const "{")))
                          (then (global.set $sigObscure
                            (i32.add (global.get $sigObscure) (i32.const 1))))
                          (else
                            (if (i32.gt_u (global.get $sigObscure) (i32.const 0))
                              (then (global.set $sigObscure
                                (i32.sub (global.get $sigObscure) (i32.const 1)))))))))))))
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
            (global.set $sigPattern (i32.const 0))
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
            ;; a comma returns to parameter position; a top-level `;` proves
            ;; the marked list was not a parameter list after all
            (global.set $sigPattern (i32.eq (local.get $c) (i32.const ",")))
            (if (i32.and
                  (i32.eq (local.get $c) (i32.const ";"))
                  (i32.and (call $sigActive) (i32.eqz (global.get $sigObscure))))
              (then (call $sigUnmark)))
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
