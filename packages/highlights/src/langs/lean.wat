(module
  (import "../common.wat")

  (func $leanByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0) (i32.lt_u (local.get $p) (global.get $end))))

  ;; Decode only within the current scan range. Cursor advancement always uses
  ;; utf8SpanEnd, including on malformed or incomplete editor input.
  (func $leanCodepoint (param $p i32) (result i32)
    (local $c i32)
    (local.set $c (call $leanByte (local.get $p)))
    (if (i32.lt_u (local.get $c) (i32.const 0xc0)) (then (return (local.get $c))))
    (if (i32.lt_u (local.get $c) (i32.const 0xe0))
      (then (return (i32.or (i32.shl (i32.and (local.get $c) (i32.const 31)) (i32.const 6))
        (i32.and (call $leanByte (i32.add (local.get $p) (i32.const 1))) (i32.const 63))))))
    (if (i32.lt_u (local.get $c) (i32.const 0xf0))
      (then (return (i32.or
        (i32.or (i32.shl (i32.and (local.get $c) (i32.const 15)) (i32.const 12))
          (i32.shl (i32.and (call $leanByte (i32.add (local.get $p) (i32.const 1))) (i32.const 63)) (i32.const 6)))
        (i32.and (call $leanByte (i32.add (local.get $p) (i32.const 2))) (i32.const 63))))))
    (i32.or
      (i32.or (i32.shl (i32.and (local.get $c) (i32.const 7)) (i32.const 18))
        (i32.shl (i32.and (call $leanByte (i32.add (local.get $p) (i32.const 1))) (i32.const 63)) (i32.const 12)))
      (i32.or (i32.shl (i32.and (call $leanByte (i32.add (local.get $p) (i32.const 2))) (i32.const 63)) (i32.const 6))
        (i32.and (call $leanByte (i32.add (local.get $p) (i32.const 3))) (i32.const 63)))))

  ;; Lean distinguishes letter-like identifiers from mathematical notation.
  ;; These ranges follow the lexical categories in Lean's language reference;
  ;; lambda, capital Pi/Sigma, multiplication and division remain notation.
  (func $leanIsLetter (param $c i32) (result i32)
    (if (i32.or (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const 97)) (i32.const 25))
          (i32.eq (local.get $c) (i32.const 95))) (then (return (i32.const 1))))
    (if (i32.and (i32.and (i32.le_u (i32.sub (local.get $c) (i32.const 192)) (i32.const 191)) (i32.ne (local.get $c) (i32.const 215))) (i32.ne (local.get $c) (i32.const 247))) (then (return (i32.const 1))))
    (if (i32.and (i32.and (i32.le_u (i32.sub (local.get $c) (i32.const 913)) (i32.const 24)) (i32.ne (local.get $c) (i32.const 928))) (i32.ne (local.get $c) (i32.const 931))) (then (return (i32.const 1))))
    (if (i32.and (i32.le_u (i32.sub (local.get $c) (i32.const 945)) (i32.const 24)) (i32.ne (local.get $c) (i32.const 955))) (then (return (i32.const 1))))
    (if (i32.le_u (i32.sub (local.get $c) (i32.const 970)) (i32.const 49)) (then (return (i32.const 1))))
    (if (i32.le_u (i32.sub (local.get $c) (i32.const 7936)) (i32.const 254)) (then (return (i32.const 1))))
    (if (i32.le_u (i32.sub (local.get $c) (i32.const 8448)) (i32.const 79)) (then (return (i32.const 1))))
    (if (i32.le_u (i32.sub (local.get $c) (i32.const 119964)) (i32.const 259)) (then (return (i32.const 1))))
    (i32.const 0))

  (func $leanIsRest (param $c i32) (result i32)
    (i32.or (call $leanIsLetter (local.get $c))
      (i32.or (call $lexIsDigit (local.get $c))
        (i32.or (i32.or (i32.eq (local.get $c) (i32.const 33)) (i32.or (i32.eq (local.get $c) (i32.const 63)) (i32.eq (local.get $c) (i32.const 39))))
          (i32.or (i32.le_u (i32.sub (local.get $c) (i32.const 0x2080)) (i32.const 9))
            (i32.or (i32.le_u (i32.sub (local.get $c) (i32.const 0x2090)) (i32.const 12))
              (i32.or (i32.le_u (i32.sub (local.get $c) (i32.const 0x1d62)) (i32.const 8))
                (i32.eq (local.get $c) (i32.const 0x2c7c)))))))))

  ;; The high byte primes a declaration name: 1=value, 2=type, 3=namespace.
  (keyword-table $leanWords $mem.leanWords $mem.bladeWords
    (group $Token.keyword.declaration+256 "def" "theorem" "lemma" "abbrev" "opaque" "axiom" "constant")
    (group $Token.keyword.declaration+512 "structure" "class" "inductive")
    (group $Token.keyword.import+768 "import" "namespace" "section" "open" "export" "end")
    (group $Token.keyword.declaration
      "instance" "example" "variable" "variables" "universe" "universes" "syntax" "macro" "macro_rules"
      "elab" "elab_rules" "declare_syntax_cat" "notation" "infix" "infixl" "infixr" "prefix" "postfix"
      "attribute" "deriving" "extends" "termination_by" "decreasing_by" "initialize" "builtin_initialize")
    (group $Token.keyword
      "private" "protected" "public" "noncomputable" "unsafe" "partial" "nonrec" "rec" "mutual"
      "scoped" "local" "set_option" "include" "omit" "mut" "with" "at" "as" "using")
    (group $Token.keyword.control
      "by" "fun" "forall" "exists" "match" "nomatch" "if" "then" "else" "do" "return" "for" "in"
      "let" "have" "show" "suffices" "obtain" "from" "calc" "try" "catch" "finally" "while" "unless"
      "break" "continue" "repeat" "first" "next" "case" "all_goals" "any_goals"
      "exact" "apply" "intro" "intros" "refine" "simpa" "simp" "simp_all" "rw" "rfl" "cases" "induction"
      "constructor" "assumption" "decide" "native_decide" "omega" "aesop" "grind" "contradiction" "trivial"
      "change" "dsimp" "unfold" "rintro" "rcases" "ext" "linarith" "nlinarith" "norm_num" "ring"
      "specialize" "clear" "subst" "rename_i" "done" "sorry" "admit")
    (group $Token.type.builtin "Prop" "Type" "Sort" "Nat" "Int" "Bool" "String" "Char" "Float" "Unit" "List" "Array" "Option")
    (group $Token.boolean "true" "false"))

  ;; Match the few words whose first-two/last/length hashes collide with
  ;; another Lean keyword, as other lexers do for the shared perfect hash.
  (func $leanWordKind (param $lhs i32) (param $rhs i32) (result i32)
    (if (i32.and
          (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 5))
          (i64.eq (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffff)) (i64.const "where")))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.and
          (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 7))
          (i64.eq (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffffffff)) (i64.const "prelude")))
      (then (return (enum.get $Token.keyword))))
    (if (i32.and
          (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 6))
          (i64.eq (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffffff)) (i64.const "revert")))
      (then (return (enum.get $Token.keyword.control))))
    (keyword-table.value $leanWords (local.get $lhs) (local.get $rhs)))

  (func $leanNameKind (param $expect i32) (result i32)
    (if (i32.eq (local.get $expect) (i32.const 1)) (then (return (enum.get $Token.function.definition))))
    (if (i32.eq (local.get $expect) (i32.const 2)) (then (return (enum.get $Token.type))))
    (select (enum.get $Token.namespace) (enum.get $Token.variable) (i32.eq (local.get $expect) (i32.const 3))))

  ;; Raw strings use the same counted-hash delimiter strategy as Rust. The
  ;; count stays in a checkpointed local, without a fixed delimiter-size limit.
  (func $leanRawOpen (param $prefix i32) (result i32)
    (local $p i32)
    (local.set $p (i32.add (global.get $ptr) (local.get $prefix)))
    (block $done
      (loop $hash
        (br_if $done (i32.ne (call $leanByte (local.get $p)) (i32.const "#")))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $hash)))
    (if (i32.ne (call $leanByte (local.get $p)) (i32.const 34))
      (then (return (i32.const 0))))
    ;; the quote is below $end, so the cursor lands at most on $end
    (local.set $p (i32.add (local.get $p) (i32.const 1)))
    (call $emitTok (enum.get $Token.string) (global.get $ptr) (local.get $p))
    (local.set $prefix (i32.sub (i32.sub (local.get $p) (global.get $ptr)) (local.get $prefix)))
    (global.set $ptr (local.get $p))
    (local.get $prefix))

  ;; Advance $ptr through a raw string body to just past its closing quote
  ;; and $hashes hashes, or to $end: hop between quotes with SIMD and count
  ;; hashes only at each candidate. Returns 1 when the body closed.
  (func $leanRawBody (param $hashes i32) (result i32)
    (local $q i32)
    (local $seen i32)
    (block $done
      (loop $scan
        (global.set $ptr (call $lexFindByte (global.get $ptr) (i32.const 34)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $q (i32.add (global.get $ptr) (i32.const 1)))
        (local.set $seen (i32.const 0))
        (block $matchDone
          (loop $match
            (br_if $matchDone (i32.ge_u (local.get $seen) (local.get $hashes)))
            (br_if $matchDone (i32.ne (call $leanByte (local.get $q)) (i32.const "#")))
            (local.set $seen (i32.add (local.get $seen) (i32.const 1)))
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (br $match)))
        (if (i32.eq (local.get $seen) (local.get $hashes))
          (then
            (global.set $ptr (local.get $q))
            (return (i32.const 1))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (i32.const 0))

  (func $hlLean
    (local $c i32) (local $c2 i32) (local $cp i32)
    (local $lhs i32) (local $rhs i32) (local $gap i32)
    (local $kind i32) (local $hl i32) (local $expect i32)
    (local $rawOpen i32) (local $quoted i32) (local $quotedKind i32)
    (local $attribute i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (if (local.get $rawOpen)
          (then
            (local.set $lhs (global.get $ptr))
            (if (call $leanRawBody (i32.sub (local.get $rawOpen) (i32.const 1)))
              (then (local.set $rawOpen (i32.const 0))))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))))
        (if (local.get $quoted)
          (then
            (local.set $lhs (global.get $ptr))
            (block $quotedDone
              (loop $quotedBody
                (br_if $quotedDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $cp (call $leanCodepoint (global.get $ptr)))
                (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
                (if (i32.eq (local.get $cp) (i32.const 0xbb))
                  (then (local.set $quoted (i32.const 0)) (br $quotedDone)))
                (br $quotedBody)))
            (call $emitTok (local.get $quotedKind) (local.get $lhs) (global.get $ptr))
            (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))))
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (i32.lt_u (call $scanFindSpecial (local.get $gap) (global.get $ptr) (i32.const 10) (i32.const 0) (i32.const 1)) (global.get $ptr))
          (then (local.set $expect (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (call $leanByte (local.get $lhs)))
        (local.set $c2 (call $leanByte (i32.add (local.get $lhs) (i32.const 1))))
        (local.set $cp (call $leanCodepoint (local.get $lhs)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c2) (i32.const "-")))
          (then (call $lexLineComment (i32.const 2) (enum.get $Token.comment)) (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "-")))
          (then
            (local.set $c2 (call $leanByte (i32.add (local.get $lhs) (i32.const 2))))
            (call $lexNestedBlockComment (i32.const "/-") (i32.const "-/")
              (select (enum.get $Token.comment.doc) (enum.get $Token.comment)
                (byteset.get "-!" (local.get $c2))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "r"))
          (then
            (local.set $rawOpen (call $leanRawOpen (i32.const 1)))
            (br_if $next (local.get $rawOpen))))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then (call $lexString (local.get $c) (i32.eq (local.get $c) (i32.const 34)) (enum.get $Token.string)) (br $next)))
        (if (i32.eq (local.get $cp) (i32.const 0xab))
          (then
            (local.set $quoted (i32.const 1))
            (local.set $quotedKind (call $leanNameKind (local.get $expect)))
            (local.set $expect (i32.const 0))
            (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 1)) (global.get $end)))
            (call $emitTok (local.get $quotedKind) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (call $lexIsDigit (local.get $c))
          (then (call $lexScanNumber) (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr)) (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "#")) (call $leanIsLetter (local.get $c2)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (call $leanIsLetter (local.get $cp))
          (then
            (block $nameDone
              (loop $name
                (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
                (br_if $nameDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (br_if $nameDone (i32.eqz (call $leanIsRest (call $leanCodepoint (global.get $ptr)))))
                (br $name)))
            (local.set $rhs (global.get $ptr))
            (local.set $kind (call $leanWordKind (local.get $lhs) (local.get $rhs)))
            (local.set $hl (enum.get $Token.variable))
            (if (local.get $attribute)
              (then (local.set $hl (enum.get $Token.attribute)))
              (else
                (if (local.get $expect)
                  (then
                    (local.set $hl (call $leanNameKind (local.get $expect)))
                    (if (i32.ne (call $leanByte (local.get $rhs)) (i32.const "."))
                      (then (local.set $expect (i32.const 0)))))
                  (else
                    (if (i32.ge_s (local.get $kind) (i32.const 0))
                      (then
                        (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                        (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8)))))))
                (if (i32.eq (call $leanByte (local.get $rhs)) (i32.const "."))
                  (then (local.set $hl (enum.get $Token.namespace))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 1)) (global.get $end)))
        (local.set $hl (enum.get $Token.operator))
        (if (byteset.get "()[]{}" (local.get $c)) (then (local.set $hl (enum.get $Token.punctuation.bracket))))
        (if (byteset.get ".,:;" (local.get $c)) (then (local.set $hl (enum.get $Token.punctuation.delimiter))))
        (if (i32.or (i32.eq (local.get $cp) (i32.const 0x27e8)) (i32.or (i32.eq (local.get $cp) (i32.const 0x27e9))
              (i32.or (i32.eq (local.get $cp) (i32.const 0x2983)) (i32.eq (local.get $cp) (i32.const 0x2984)))))
          (then (local.set $hl (enum.get $Token.punctuation.bracket))))
        (if (i32.or (i32.eq (local.get $cp) (i32.const 0x2200)) (i32.or (i32.eq (local.get $cp) (i32.const 0x2203))
              (i32.or (i32.eq (local.get $cp) (i32.const 0x3bb)) (i32.or (i32.eq (local.get $cp) (i32.const 0x3a0)) (i32.eq (local.get $cp) (i32.const 0x3a3))))))
          (then (local.set $hl (enum.get $Token.keyword.operator))))
        (if (i32.and (i32.eq (local.get $c) (i32.const "@")) (i32.eq (local.get $c2) (i32.const "[")))
          (then (local.set $attribute (i32.const 1))))
        (if (i32.eq (local.get $c) (i32.const "]")) (then (local.set $attribute (i32.const 0))))
        (if (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $c2) (i32.const "=")))
          (then (local.set $hl (enum.get $Token.operator)) (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))))
        (if (i32.and (i32.ne (local.get $c) (i32.const ".")) (i32.eqz (local.get $attribute)))
          (then (local.set $expect (i32.const 0))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
