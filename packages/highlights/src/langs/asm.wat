(module
  (import "../common.wat")

  ;; whether [$lhs,$rhs) names a machine register: `r`/`x`/`w` followed by a
  ;; digit, a RISC-V ABI name - `a0`..`a7`, `t0`..`t6`, `s0`..`s11`, `ra`,
  ;; `gp`, `tp`, `zero` - `xmm`/`ymm`/`zmm` plus a digit, one of the fixed
  ;; two-byte names, an x86 8- or 16-bit or segment name - `al`..`dx`, `si`,
  ;; `di`, `bp`, `cs`..`ss`, `sil`, `dil`, `spl`, `bpl` - or an `e`/`r`
  ;; prefixed x86 name - `eax`..`edx`, `esi`, `edi`, `ebp`, `esp`, `eip` and
  ;; their 64-bit `r` forms. The wide loads below may read up to three bytes
  ;; past $rhs; that always lands inside the input buffer's trailing slack,
  ;; and the length checks plus the masks discard whatever those bytes hold.
  (func $asmIsRegister (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    (local $n i32)
    (local $w i32)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (local.set $c (i32.or (i32.load8_u (local.get $lhs)) (i32.const 32)))
    (if
      (i32.and
        (i32.gt_u (local.get $n) (i32.const 1))
        (i32.and
          (i32.or
            (i32.eq (local.get $c) (i32.const "r"))
            (i32.or
              (i32.eq (local.get $c) (i32.const "x"))
              (i32.eq (local.get $c) (i32.const "w"))))
          (call $lexIsDigit (i32.load8_u offset=1 (local.get $lhs)))))
      (then (return (i32.const 1))))
    ;; RISC-V argument, temporary and saved registers: one letter and one or
    ;; two digits
    (if
      (i32.and
        (i32.le_u (i32.sub (local.get $n) (i32.const 2)) (i32.const 1))
        (i32.or
          (i32.eq (local.get $c) (i32.const "a"))
          (i32.or
            (i32.eq (local.get $c) (i32.const "t"))
            (i32.eq (local.get $c) (i32.const "s")))))
      (then
        (if (call $lexIsDigit (i32.load8_u offset=1 (local.get $lhs)))
          (then
            (if
              (i32.or
                (i32.eq (local.get $n) (i32.const 2))
                (call $lexIsDigit (i32.load8_u offset=2 (local.get $lhs))))
              (then (return (i32.const 1))))))))
    (local.set $w (i32.or (i32.load (local.get $lhs)) (i32.const 0x20202020)))
    ;; vector registers: `xmm0`..`zmm31`
    (if
      (i32.and
        (i32.le_u (i32.sub (local.get $n) (i32.const 4)) (i32.const 1))
        (i32.and
          (i32.eq (i32.and (local.get $w) (i32.const 0x00ffff00)) (i32.const 0x006d6d00))
          (i32.and
            (i32.le_u (i32.sub (local.get $c) (i32.const "x")) (i32.const 2))
            (call $lexIsDigit (i32.load8_u offset=3 (local.get $lhs))))))
      (then (return (i32.const 1))))
    ;; every remaining name but RISC-V's `zero` is two or three bytes, so one
    ;; compare skips the whole ladder for ordinary mnemonics and symbols
    (if (i32.gt_u (local.get $n) (i32.const 3))
      (then
        (return
          (i32.and
            (i32.eq (local.get $n) (i32.const 4))
            (i32.eq (local.get $w) (i32.const "zero"))))))
    (if (i32.eq (local.get $n) (i32.const 2))
      (then
        (local.set $w (i32.and (local.get $w) (i32.const 0xffff)))
        ;; x86 `al`/`ah`/`ax` through `dl`/`dh`/`dx`
        (local.set $n (i32.shr_u (local.get $w) (i32.const 8)))
        (if
          (i32.and
            (i32.le_u (i32.sub (local.get $c) (i32.const "a")) (i32.const 3))
            (i32.or
              (i32.eq (local.get $n) (i32.const "x"))
              (i32.or (i32.eq (local.get $n) (i32.const "l")) (i32.eq (local.get $n) (i32.const "h")))))
          (then (return (i32.const 1))))
        ;; x86 segment registers `cs`, `ds`, `es`, `fs`, `gs`, `ss`
        (if
          (i32.and
            (i32.eq (local.get $n) (i32.const "s"))
            (i32.or
              (i32.le_u (i32.sub (local.get $c) (i32.const "c")) (i32.const 4))
              (i32.eq (local.get $c) (i32.const "s"))))
          (then (return (i32.const 1))))
        (return
          (i32.or
            (i32.or
              (i32.or
                (i32.eq (local.get $w) (i32.const "sp"))
                (i32.eq (local.get $w) (i32.const "fp")))
              (i32.or
                (i32.eq (local.get $w) (i32.const "lr"))
                (i32.eq (local.get $w) (i32.const "pc"))))
            (i32.or
              (i32.or
                (i32.or
                  (i32.eq (local.get $w) (i32.const "si"))
                  (i32.eq (local.get $w) (i32.const "di")))
                (i32.eq (local.get $w) (i32.const "bp")))
              (i32.or
                (i32.eq (local.get $w) (i32.const "ra"))
                (i32.or
                  (i32.eq (local.get $w) (i32.const "gp"))
                  (i32.eq (local.get $w) (i32.const "tp")))))))))
    (if (i32.ne (local.get $n) (i32.const 3))
      (then (return (i32.const 0))))
    ;; without the `e`/`r` prefix, only the x86-64 low bytes of the index
    ;; and pointer registers remain
    (if (i32.and (i32.ne (local.get $c) (i32.const "e")) (i32.ne (local.get $c) (i32.const "r")))
      (then
        (local.set $w (i32.and (local.get $w) (i32.const 0xffffff)))
        (return
          (i32.or
            (i32.or
              (i32.eq (local.get $w) (i32.const "sil"))
              (i32.eq (local.get $w) (i32.const "dil")))
            (i32.or
              (i32.eq (local.get $w) (i32.const "spl"))
              (i32.eq (local.get $w) (i32.const "bpl")))))))
    ;; the two bytes after the `e`/`r` prefix
    (local.set $w (i32.and (i32.shr_u (local.get $w) (i32.const 8)) (i32.const 0xffff)))
    (i32.or
      (i32.or
        (i32.or (i32.eq (local.get $w) (i32.const "ax")) (i32.eq (local.get $w) (i32.const "bx")))
        (i32.or (i32.eq (local.get $w) (i32.const "cx")) (i32.eq (local.get $w) (i32.const "dx"))))
      (i32.or
        (i32.or (i32.eq (local.get $w) (i32.const "si")) (i32.eq (local.get $w) (i32.const "di")))
        (i32.or
          (i32.or (i32.eq (local.get $w) (i32.const "bp")) (i32.eq (local.get $w) (i32.const "sp")))
          (i32.eq (local.get $w) (i32.const "ip"))))))

  (func $hlAsm
    (local $c i32)
    (local $expectMnemonic i32)
    (local $hl i32)
    (local $lhs i32)
    (local $next i32)
    (local $next2 i32)
    (local $p i32)
    (local $prefixedNumber i32)
    (local.set $expectMnemonic (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $token
        (local.set $lhs (global.get $ptr))
        (call $scanWhitespace)
        ;; a line break in the gap puts the next word in mnemonic position
        (if
          (i32.lt_u
            (call $scanFindSpecial
              (local.get $lhs)
              (global.get $ptr)
              (i32.const 10)
              (i32.const 0)
              (i32.const 1))
            (global.get $ptr))
          (then (local.set $expectMnemonic (i32.const 1))))
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $next
          (select
            (i32.load8_u offset=1 (global.get $ptr))
            (i32.const 0)
            (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
        (local.set $next2
          (select
            (i32.load8_u offset=2 (global.get $ptr))
            (i32.const 0)
            (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))))
        (local.set $prefixedNumber
          (i32.and
            (i32.or (i32.eq (local.get $c) (i32.const "#")) (i32.eq (local.get $c) (i32.const "$")))
            (i32.or
              (call $lexIsDigit (local.get $next))
              (i32.and
                (i32.or
                  (i32.eq (local.get $next) (i32.const "+"))
                  (i32.eq (local.get $next) (i32.const "-")))
                (call $lexIsDigit (local.get $next2))))))

        ;; GNU as accepts C block comments alongside `;`, `//` and `#`
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "/"))
            (i32.eq (local.get $next) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $token)))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const ";"))
            (i32.or
              (i32.and
                (i32.eq (local.get $c) (i32.const "/"))
                (i32.eq (local.get $next) (i32.const "/")))
              (i32.and
                (i32.eq (local.get $c) (i32.const "#"))
                (i32.eqz (local.get $prefixedNumber)))))
          (then
            (call $lexLineComment
              (select (i32.const 2) (i32.const 1) (i32.eq (local.get $c) (i32.const "/")))
              (enum.get $Token.comment))
            (br $token)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (local.set $expectMnemonic (i32.const 0))
            (br $token)))
        (if (i32.or (call $lexIsDigit (local.get $c)) (local.get $prefixedNumber))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if
              (i32.and
                (local.get $prefixedNumber)
                (i32.or
                  (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "+"))
                  (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "-"))))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $lexScanNumber)
            ;; a digit run opening a statement with a `:` glued on is a GNU as
            ;; local label, `1:  jmp 1b`, and like any label leaves the
            ;; mnemonic position open
            (if
              (i32.and
                (i32.and (local.get $expectMnemonic) (i32.eqz (local.get $prefixedNumber)))
                (i32.and
                  (i32.lt_u (global.get $ptr) (global.get $end))
                  (i32.eq (i32.load8_u (global.get $ptr)) (i32.const ":"))))
              (then
                (call $emitTok (enum.get $Token.label) (local.get $lhs) (global.get $ptr))
                (br $token)))
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $expectMnemonic (i32.const 0))
            (br $token)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "%")) (i32.eq (local.get $c) (i32.const "$")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
            (local.set $expectMnemonic (i32.const 0))
            (br $token)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
            (local.set $hl
              (select
                (enum.get $Token.label)
                (enum.get $Token.preproc)
                (i32.and
                  (i32.lt_u (local.get $p) (global.get $end))
                  (i32.eq (i32.load8_u (local.get $p)) (i32.const ":")))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (if (i32.eq (local.get $hl) (enum.get $Token.label))
              (then (local.set $expectMnemonic (i32.const 1)))
              (else (local.set $expectMnemonic (i32.const 0))))
            (br $token)))
        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
            (local.set $hl (enum.get $Token.variable))
            (if
              (i32.and
                (i32.lt_u (local.get $p) (global.get $end))
                (i32.eq (i32.load8_u (local.get $p)) (i32.const ":")))
              (then (local.set $hl (enum.get $Token.label)))
              (else
                (if (local.get $expectMnemonic)
                  (then (local.set $hl (enum.get $Token.keyword)))
                  (else
                    (if (call $asmIsRegister (local.get $lhs) (global.get $ptr))
                      (then (local.set $hl (enum.get $Token.variable.special))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (local.set $expectMnemonic
              (select (i32.const 1) (i32.const 0) (i32.eq (local.get $hl) (enum.get $Token.label))))
            (br $token)))
        ;; any other byte: a bracket, a delimiter, or an operator
        (local.set $hl (enum.get $Token.operator))
        (if
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const ")")))
            (i32.or
              (i32.eq (local.get $c) (i32.const "["))
              (i32.eq (local.get $c) (i32.const "]"))))
          (then (local.set $hl (enum.get $Token.punctuation.bracket))))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ":")))
          (then (local.set $hl (enum.get $Token.punctuation.delimiter))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $token))))
)
