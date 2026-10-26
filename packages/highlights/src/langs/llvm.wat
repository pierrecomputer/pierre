(module
  (import "../common.wat")

  ;; Instructions are keywords and terminators control keywords. Linkage,
  ;; flags, and the function and parameter attributes are attributes, as
  ;; LLVM names them. Integer types `iN`, the vector `x`, and the `c"..."`
  ;; prefix are matched by shape in $hlLlvm, and `fptoui` and `norecurse`,
  ;; which share hash features with `fptosi` and `nocapture`, in $llvmWordHl.
  (keyword-table $llvmWords $mem.llvmWords $mem.openscadWords
    (group $Token.keyword.declaration
      "asm" "type" "alias" "define" "global" "module" "target" "triple" "declare" "constant"
      "attributes" "datalayout" "source_filename")
    (group $Token.keyword.control
      "br" "ret" "invoke" "resume" "switch" "callbr" "catchret" "cleanupret" "indirectbr"
      "catchswitch" "unreachable")
    (group $Token.keyword
      "or" "add" "and" "mul" "phi" "shl" "sub" "xor" "ashr" "call" "fadd" "fcmp" "fdiv" "fmul"
      "fneg" "frem" "fsub" "icmp" "load" "lshr" "sdiv" "sext" "srem" "udiv" "urem" "zext"
      "fence" "fpext" "store" "trunc" "alloca" "fptosi" "freeze" "select" "sitofp"
      "uitofp" "va_arg" "bitcast" "cmpxchg" "fptrunc" "catchpad" "inttoptr" "ptrtoint"
      "atomicrmw" "cleanuppad" "landingpad" "insertvalue" "extractvalue" "addrspacecast"
      "getelementptr" "insertelement" "shufflevector" "extractelement")
    (group $Token.type.builtin
      "ptr" "half" "void" "float" "label" "token" "bfloat" "double" "fp128" "opaque" "metadata"
      "x86_amx" "x86_fp80" "ppc_fp128")
    (group $Token.keyword.operator
      "eq" "ne" "oeq" "oge" "ogt" "ole" "olt" "one" "ord" "sge" "sgt" "sle" "slt" "ueq" "uge"
      "ugt" "ule" "ult" "une" "uno")
    (group $Token.attribute
      "to" "any" "nsw" "nuw" "ssp" "sret" "tail" "cold" "fast" "nnan" "ninf" "weak" "read" "align"
      "byval" "catch" "exact" "write" "common" "comdat" "fastcc" "hidden" "atomic" "inreg"
      "nofree" "nosync" "memory" "argmem" "private" "noalias" "noundef" "nonnull" "uwtable"
      "acquire" "release" "acq_rel" "seq_cst" "zeroext" "signext" "section" "cleanup"
      "returned" "volatile" "inbounds" "internal" "external" "musttail" "noinline" "readonly"
      "readnone" "optnone" "distinct" "nounwind" "noreturn" "addrspace" "dso_local" "nocapture"
      "writeonly" "monotonic" "readwrite" "weak_odr" "willreturn" "convergent"
      "sspstrong" "personality" "linkonce_odr" "alwaysinline" "mustprogress" "thread_local"
      "unnamed_addr" "speculatable" "dereferenceable" "inaccessiblemem" "local_unnamed_addr")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "none" "null" "undef" "poison" "zeroinitializer"))

  (func $llvmWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    ;; the wide loads stay inside the input slack
    (if
      (i32.and
        (i32.eq (local.get $n) (i32.const 6))
        (i64.eq (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffffff)) (i64.const "fptoui")))
      (then (return (enum.get $Token.keyword))))
    (if
      (i32.and
        (i32.eq (local.get $n) (i32.const 9))
        (i32.and
          (i64.eq (i64.load (local.get $lhs)) (i64.const "norecurs"))
          (i32.eq (i32.load8_u offset=8 (local.get $lhs)) (i32.const "e"))))
      (then (return (enum.get $Token.attribute))))
    (keyword-table.value $llvmWords (local.get $lhs) (local.get $rhs)))

  ;; Advance $ptr over a name: [-$._A-Za-z0-9] and UTF-8 bytes.
  (func $llvmName
    (block $done
      (loop $more
        (call $scanIdentRun (i32.const "."))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (br_if $done
          (i32.and
            (i32.ne (i32.load8_u (global.get $ptr)) (i32.const "-"))
            (i32.ne (i32.load8_u (global.get $ptr)) (i32.const "$"))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $more))))

  ;; A one-line string from the quote at $ptr. `\\` and `\` with two hex
  ;; digits are escapes; any other backslash is text.
  (func $llvmString
    (local $seg i32)
    (local $e i32)
    (local.set $seg (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (block $done
      (loop $scan
        (global.set $ptr
          (call $scanFindSpecial
            (global.get $ptr)
            (global.get $end)
            (i32.const 34)
            (i32.const 1)
            (i32.const 1)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (if (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 34))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $done)))
        ;; a raw line break ends an unterminated string
        (br_if $done (i32.ne (i32.load8_u (global.get $ptr)) (i32.const 92)))
        (local.set $e (i32.add (global.get $ptr) (i32.const 2)))
        (if (i32.ne (call $templateByte (i32.sub (local.get $e) (i32.const 1))) (i32.const 92))
          (then
            (local.set $e (i32.add (local.get $e) (i32.const 1)))
            (if (i32.ne (call $scanHexRun (i32.add (global.get $ptr) (i32.const 1)) (i32.const 2)) (local.get $e))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $scan)))))
        (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
        (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
        (global.set $ptr (local.get $e))
        (local.set $seg (local.get $e))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr)))

  ;; Sigils name values: `%local`, `@global` (a function before `(`),
  ;; `$comdat`, `#0` attribute groups, and `!0`/`!dbg` metadata (a node type
  ;; before `(`). Words ending in `:` are labels at a line start and
  ;; metadata fields elsewhere. The lexer keeps no state between lines.
  (func $hlLlvm
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $gap i32)
    (local $hl i32)
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

        (if (i32.eq (local.get $c) (i32.const ";"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $llvmString)
            (br $next)))

        (local.set $hl (i32.const -1))
        (if (i32.eq (local.get $c) (i32.const "%"))
          (then (local.set $hl (enum.get $Token.variable))))
        (if (i32.or (i32.eq (local.get $c) (i32.const "@")) (i32.eq (local.get $c) (i32.const "$")))
          (then (local.set $hl (enum.get $Token.variable.special))))
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then (local.set $hl (enum.get $Token.attribute))))
        (if (i32.eq (local.get $c) (i32.const "!"))
          (then (local.set $hl (enum.get $Token.constant))))
        (if (i32.ge_s (local.get $hl) (i32.const 0))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            ;; `%"a b"` and `@"x"` quote a name; `!"..."` is a metadata string
            (if (i32.and (i32.eq (local.get $c2) (i32.const 34)) (i32.ne (local.get $c) (i32.const "!")))
              (then
                (global.set $ptr
                  (call $scanFindSpecial
                    (i32.add (global.get $ptr) (i32.const 1))
                    (global.get $end)
                    (i32.const 34)
                    (i32.const 0)
                    (i32.const 1)))
                (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const 34))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1))))))
              (else (call $llvmName)))
            (if (i32.eq (call $templateByte (call $lexSkipSpaceAt (global.get $ptr))) (i32.const "("))
              (then
                (if (i32.eq (local.get $c) (i32.const "@"))
                  (then (local.set $hl (enum.get $Token.function))))
                (if (i32.eq (local.get $c) (i32.const "!"))
                  (then (local.set $hl (enum.get $Token.type))))))
            ;; a bare `!` opens a metadata tuple `!{...}` or string `!"..."`
            (if (i32.eq (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1)))
              (then (local.set $hl (enum.get $Token.punctuation.special))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const "-")) (call $lexIsDigit (local.get $c2))))
          (then
            ;; a numbered block `3:` opens its line like a named label
            (if (i32.eqz (call $lexLineByteBefore (local.get $lhs)))
              (then
                (call $llvmName)
                (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const ":"))
                  (then
                    (call $emitTok (enum.get $Token.label) (local.get $lhs) (global.get $ptr))
                    (br $next)))))
            (global.set $ptr (i32.add (local.get $lhs) (i32.eq (local.get $c) (i32.const "-"))))
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if
          (i32.or
            (i32.ge_u (local.get $c) (i32.const 0x80))
            (i32.or
              (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
              (i32.eq (local.get $c) (i32.const "_"))))
          (then
            ;; `c"..."` is a byte-array constant
            (if (i32.and (i32.eq (local.get $c) (i32.const "c")) (i32.eq (local.get $c2) (i32.const 34)))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (call $llvmString)
                (br $next)))
            (call $llvmName)
            (local.set $rhs (global.get $ptr))
            (block $classified
              (if (i32.eq (call $templateByte (local.get $rhs)) (i32.const ":"))
                (then
                  (local.set $hl
                    (select
                      (enum.get $Token.property)
                      (enum.get $Token.label)
                      (call $lexLineByteBefore (local.get $lhs))))
                  (br $classified)))
              (local.set $hl (call $llvmWordHl (local.get $lhs) (local.get $rhs)))
              (br_if $classified (i32.ge_s (local.get $hl) (i32.const 0)))
              ;; `<4 x i32>` and `[2 x i8]`
              (if (i32.and (i32.eq (local.get $c) (i32.const "x")) (i32.eq (local.get $rhs) (i32.add (local.get $lhs) (i32.const 1))))
                (then
                  (local.set $hl (enum.get $Token.keyword.operator))
                  (br $classified)))
              ;; `i1`, `i32`, and any other integer width
              (if (i32.and (i32.eq (local.get $c) (i32.const "i")) (call $lexIsDigit (local.get $c2)))
                (then
                  (local.set $hl (enum.get $Token.type.builtin))
                  (local.set $c2 (i32.add (local.get $lhs) (i32.const 1)))
                  (block $width
                    (loop $digit
                      (br_if $width (i32.ge_u (local.get $c2) (local.get $rhs)))
                      (if (i32.eqz (call $lexIsDigit (i32.load8_u (local.get $c2))))
                        (then
                          (local.set $hl (enum.get $Token.none))
                          (br $width)))
                      (local.set $c2 (i32.add (local.get $c2) (i32.const 1)))
                      (br $digit)))
                  (br $classified)))
              ;; DWARF enumerators: `DW_TAG_variable`, `DIFlagPrototyped`
              (local.set $hl (enum.get $Token.none))
              (if
                (i32.or
                  (i32.eq (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff)) (i32.const "DW_"))
                  (i32.eq (i32.load (local.get $lhs)) (i32.const "DIFl")))
                (then (local.set $hl (enum.get $Token.constant.builtin)))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (local.set $hl (enum.get $Token.none))
        ;; `| 2` maps only `<` and `>` onto `>`
        (if
          (i32.or
            (byteset.get "()[]{}" (local.get $c))
            (i32.eq (i32.or (local.get $c) (i32.const 2)) (i32.const ">")))
          (then (local.set $hl (enum.get $Token.punctuation.bracket))))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ":")))
          (then (local.set $hl (enum.get $Token.punctuation.delimiter))))
        (if (i32.or (i32.eq (local.get $c) (i32.const "=")) (i32.eq (local.get $c) (i32.const "*")))
          (then (local.set $hl (enum.get $Token.operator))))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "."))
            (i32.and
              (i32.eq (local.get $c2) (i32.const "."))
              (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "."))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))
            (local.set $hl (enum.get $Token.operator))))
        (if (i32.eqz (local.get $hl))
          (then (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
