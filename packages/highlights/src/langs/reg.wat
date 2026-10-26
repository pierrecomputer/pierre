(module
  (import "../common.wat")

  ;; Windows Registry Editor files: a version header, `[HKEY_…]` keys (`[-…]`
  ;; deletes one), `"name"` or `@` values, and string, `dword:`, `qword:`, or
  ;; `hex(N):` data. Data bytes are hex digits; a `\` continues a byte list
  ;; on the next line. $col is 0 at a line start, 1 after the first token.
  (func $hlReg
    (local $c i32)
    (local $lhs i32)
    (local $gap i32)
    (local $n i32)
    (local $p i32)
    (local $hl i32)
    (local $col i32)
    (local $w i64)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then (local.set $col (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if (i32.eq (local.get $c) (i32.const ";"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexString
              (i32.const 34)
              (i32.const 0)
              (select (enum.get $Token.string) (enum.get $Token.property) (local.get $col)))
            (local.set $col (i32.const 1))
            (br $next)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (block $emit
          (if (i32.eqz (local.get $col))
            (then
              (local.set $col (i32.const 1))
              (local.set $hl (enum.get $Token.variable.special))
              (br_if $emit (i32.eq (local.get $c) (i32.const "@")))
              (if (i32.eq (local.get $c) (i32.const "["))
                (then
                  (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                  (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "-"))
                    (then
                      (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                      (call $emitTok (enum.get $Token.operator) (i32.sub (global.get $ptr) (i32.const 1)) (global.get $ptr))))
                  (local.set $lhs (global.get $ptr))
                  (global.set $ptr
                    (call $scanFindSpecial (global.get $ptr) (global.get $end) (i32.const "]") (i32.const 0) (i32.const 1)))
                  (call $emitTok (enum.get $Token.type) (local.get $lhs) (global.get $ptr))
                  (local.set $lhs (global.get $ptr))
                  (local.set $hl (enum.get $Token.punctuation.bracket))
                  (br_if $next (i32.ne (call $templateByte (local.get $lhs)) (i32.const "]")))
                  (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                  (br $emit)))
              ;; `Windows Registry Editor Version 5.00` or `REGEDIT4`
              (local.set $w (i64.load (local.get $lhs)))
              (if
                (i32.and
                  (i32.le_u (i32.add (local.get $lhs) (i32.const 8)) (global.get $end))
                  (i32.or (i64.eq (local.get $w) (i64.const "Windows ")) (i64.eq (local.get $w) (i64.const "REGEDIT4"))))
                (then
                  (call $scanToLineEnd)
                  (local.set $hl (enum.get $Token.keyword))
                  (br $emit)))))
          (local.set $hl (enum.get $Token.operator))
          (br_if $emit (i32.or (i32.eq (local.get $c) (i32.const "=")) (i32.eq (local.get $c) (i32.const "-"))))
          (local.set $hl (enum.get $Token.punctuation.special))
          (br_if $emit (i32.eq (local.get $c) (i32.const 92)))
          (local.set $hl (enum.get $Token.punctuation.delimiter))
          (br_if $emit (byteset.get ",:;" (local.get $c)))
          (local.set $hl (enum.get $Token.punctuation.bracket))
          (br_if $emit (byteset.get "()" (local.get $c)))
          (local.set $hl (enum.get $Token.none))
          (global.set $ptr (local.get $lhs))
          (call $scanIdentRun (i32.const "_"))
          (local.set $n (i32.sub (global.get $ptr) (local.get $lhs)))
          (if (i32.eqz (local.get $n))
            (then
              (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
              (br $emit)))
          ;; `dword:`, `qword:`, `hex:`, and `hex(N):` in any case
          (local.set $w
            (i64.and
              (i64.or (i64.load (local.get $lhs)) (i64.const 0x2020202020))
              (i64.sub
                (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $n) (i32.const 3))))
                (i64.const 1))))
          (local.set $c (call $templateByte (global.get $ptr)))
          (local.set $hl (enum.get $Token.type.builtin))
          (br_if $emit
            (i32.and
              (i32.and
                (i32.le_u (local.get $n) (i32.const 5))
                (i32.or (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $c) (i32.const "("))))
              (i32.or
                (i32.or (i64.eq (local.get $w) (i64.const "dword")) (i64.eq (local.get $w) (i64.const "qword")))
                (i64.eq (local.get $w) (i64.const "hex")))))
          ;; a run of hex digits is data
          (local.set $hl (enum.get $Token.number))
          (local.set $p (local.get $lhs))
          (block $plain
            (loop $digits
              (br_if $emit (i32.ge_u (local.get $p) (global.get $ptr)))
              (br_if $plain (i32.eqz (call $lexIsHex (i32.load8_u (local.get $p)))))
              (local.set $p (i32.add (local.get $p) (i32.const 1)))
              (br $digits)))
          (local.set $hl (enum.get $Token.none)))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
