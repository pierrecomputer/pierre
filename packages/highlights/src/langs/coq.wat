(module
  (import "../common.wat")

  ;; The high byte primes the next name: 1 a function definition, 2 a type
  ;; and then its constructors, 3 a namespace, 4 namespaces until the
  ;; sentence ends. Other vernacular commands are found by shape: a
  ;; capitalized word that starts a sentence.
  (keyword-table $coqWords $mem.coqWords $mem.wolframWords
    (group $Token.keyword.declaration+256
      "Theorem" "Lemma" "Definition" "Fixpoint" "CoFixpoint" "Function" "Example" "Corollary"
      "Fact" "Remark" "Proposition" "Instance" "Let" "Ltac")
    (group $Token.keyword.declaration+512 "Inductive" "CoInductive" "Record" "Structure" "Class" "Variant")
    (group $Token.keyword.import+768 "Module" "Section" "End")
    (group $Token.keyword.import+1024 "Require" "Import" "Export" "From")
    (group $Token.keyword "Scope" "Implicit" "Arguments" "Proof" "as" "struct" "where" "at" "using")
    (group $Token.keyword.control
      "forall" "exists" "fun" "match" "with" "end" "let" "in" "if" "then" "else" "return" "fix" "by"
      "intros" "intro" "apply" "eapply" "rewrite" "simpl" "reflexivity" "induction" "destruct" "auto"
      "eauto" "trivial" "exact" "split" "lia" "ring" "assumption" "constructor" "discriminate"
      "congruence" "unfold" "subst" "symmetry" "specialize" "generalize" "clear" "pose" "set" "assert"
      "left" "right" "exfalso" "contradiction" "tauto" "easy" "now" "try" "repeat" "first" "solve" "do"
      "case" "remember" "f_equal" "cbn" "refine" "change" "admit")
    (group $Token.type.builtin "Type" "Prop" "Set" "nat" "bool" "list" "option")
    (group $Token.constant.builtin "True" "False" "None" "Some" "nil")
    (group $Token.boolean "true" "false"))

  ;; Match the tactics whose first-two/last/length hashes collide with
  ;; `induction` and `repeat` in the shared perfect hash.
  (func $coqWordKind (param $lhs i32) (param $rhs i32) (result i32)
    (local $w i64)
    (local.set $w (i64.load (local.get $lhs)))
    (if
      (i32.and
        (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 9))
        (i32.and
          (i32.eq (i32.load8_u offset=8 (local.get $lhs)) (i32.const "n"))
          (i32.or
            (i64.eq (local.get $w) (i64.const "inversio"))
            (i32.or
              (i64.eq (local.get $w) (i64.const "injectio"))
              (i64.eq (local.get $w) (i64.const "intuitio"))))))
      (then (return (enum.get $Token.keyword.control))))
    (if
      (i32.and
        (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 6))
        (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "revert")))
      (then (return (enum.get $Token.keyword.control))))
    (keyword-table.value $coqWords (local.get $lhs) (local.get $rhs)))

  ;; $expect is the pending name: 1 a function definition, 2 a type, 3 a
  ;; namespace, 4 namespaces until the sentence ends (`Require Import`), 6
  ;; inside an inductive or record body, 7 a constructor after `:=` or `|`
  ;; there. $mid is 0 at a sentence start, where a capitalized word is a
  ;; vernacular command, 2 inside the command's leading words (`Hint
  ;; Resolve`, `Local Open Scope`), and 1 elsewhere. $attr is 1 inside
  ;; `#[...]`. All are checkpointed.
  (func $hlCoq
    (local $c i32) (local $c2 i32) (local $lhs i32) (local $rhs i32) (local $gap i32)
    (local $kind i32) (local $hl i32) (local $cap i32)
    (local $expect i32) (local $mid i32) (local $attr i32)
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
        ;; `(* ... *)` nests; `(** ... *)` documents
        (if (i32.and (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexNestedBlockComment
              (i32.const "(*")
              (i32.const "*)")
              (select
                (enum.get $Token.comment.doc)
                (enum.get $Token.comment)
                (i32.and
                  (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "*"))
                  (i32.ne (call $templateByte (i32.add (local.get $lhs) (i32.const 3))) (i32.const ")")))))
            (br $next)))
        ;; a doubled `""` escapes a quote: two adjacent strings
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexRawString (i32.const 34) (i32.const 1) (enum.get $Token.string))
            (local.set $mid (i32.const 1))
            (br $next)))
        (if (call $lexIsDigit (local.get $c))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $mid (i32.const 1))
            (br $next)))
        ;; names continue with primes (`n'`); a 0xe2 lead byte starts a
        ;; notation such as `→` or `∀`
        (if
          (i32.and
            (call $lexIsIdentStart (local.get $c))
            (i32.and (i32.ne (local.get $c) (i32.const "$")) (i32.ne (local.get $c) (i32.const 0xe2))))
          (then
            (call $scanIdentRun (i32.const 39))
            (local.set $rhs (global.get $ptr))
            (local.set $kind (call $coqWordKind (local.get $lhs) (local.get $rhs)))
            (local.set $cap (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))
            (local.set $hl (enum.get $Token.variable))
            (block $classified
              ;; a branch that leaves $mid1 also sets $mid to 1
              (block $mid1
              (if (local.get $attr)
                (then
                  (local.set $hl (enum.get $Token.attribute))
                  (br $classified)))
              (if (i32.gt_s (local.get $kind) (i32.const 255))
                (then
                  (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                  (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8)))
                  (br $mid1)))
              (if (i32.le_u (i32.sub (local.get $expect) (i32.const 1)) (i32.const 2))
                (then
                  (local.set $hl
                    (select
                      (enum.get $Token.function.definition)
                      (select (enum.get $Token.type) (enum.get $Token.namespace) (i32.eq (local.get $expect) (i32.const 2)))
                      (i32.eq (local.get $expect) (i32.const 1))))
                  (local.set $expect (select (i32.const 6) (i32.const 0) (i32.eq (local.get $expect) (i32.const 2))))
                  (br $mid1)))
              (if (i32.eq (local.get $expect) (i32.const 7))
                (then
                  (local.set $hl (enum.get $Token.constructor))
                  (local.set $expect (i32.const 6))
                  (br $mid1)))
              (if (i32.and (i32.eqz (local.get $mid)) (local.get $cap))
                (then
                  (local.set $hl (enum.get $Token.keyword))
                  (local.set $mid (i32.const 2))
                  (br $classified)))
              (if (i32.eq (local.get $expect) (i32.const 4))
                (then
                  (local.set $hl (enum.get $Token.namespace))
                  (br $classified)))
              (if (i32.ge_s (local.get $kind) (i32.const 0))
                (then
                  (local.set $hl (local.get $kind))
                  (br $mid1)))
              ;; `Hint Resolve x`: a capitalized word between a command and
              ;; another word belongs to the command
              (if
                (i32.and
                  (i32.and (i32.eq (local.get $mid) (i32.const 2)) (local.get $cap))
                  (i32.and
                    (i32.gt_u (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 1))
                    (call $lexIsIdentStart (call $templateByte (call $lexSkipSpaceAt (local.get $rhs))))))
                (then
                  (local.set $hl (enum.get $Token.keyword))
                  (br $classified)))
              (if
                (i32.and
                  (i32.eq (call $templateByte (local.get $rhs)) (i32.const "."))
                  (call $lexIsIdentStart (call $templateByte (i32.add (local.get $rhs) (i32.const 1)))))
                (then (local.set $hl (enum.get $Token.namespace)))))
              (local.set $mid (i32.const 1)))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))
        ;; a `.` before a blank or the end closes the sentence
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $mid (i32.const 1))
            (if (i32.or (i32.eqz (local.get $c2)) (call $lexIsSpace (local.get $c2)))
              (then
                (local.set $mid (i32.const 0))
                (local.set $expect (i32.const 0))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "#")) (i32.eq (local.get $c2) (i32.const "[")))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (local.set $attr (i32.const 1))
            (br $next)))
        (if (i32.and (local.get $attr) (i32.eq (local.get $c) (i32.const "]")))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (local.set $attr (i32.const 0))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 1)) (global.get $end)))
        (local.set $hl (enum.get $Token.operator))
        (local.set $kind (i32.const 0))
        (if (byteset.get "()[]{}" (local.get $c))
          (then (local.set $hl (enum.get $Token.punctuation.bracket))))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then (local.set $hl (enum.get $Token.punctuation.delimiter))))
        (if (i32.or (byteset.get "!$%&*+-/:<=>?\5c^|~" (local.get $c)) (i32.eq (local.get $c) (i32.const "@")))
          (then
            (block $opDone
              (loop $op
                (br_if $opDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c2 (i32.load8_u (global.get $ptr)))
                (br_if $opDone
                  (i32.eqz
                    (i32.or
                      (byteset.get "!$%&*+-/:<=>?\5c^|~" (local.get $c2))
                      (i32.eq (local.get $c2) (i32.const "@")))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (local.set $rhs (i32.sub (global.get $ptr) (local.get $lhs)))
            (if (i32.and (i32.eq (local.get $rhs) (i32.const 1)) (i32.eq (local.get $c) (i32.const ":")))
              (then (local.set $hl (enum.get $Token.punctuation.delimiter))))
            ;; proof bullets start a sentence
            (if (i32.and (i32.eqz (local.get $mid)) (byteset.get "*+-|" (local.get $c)))
              (then (local.set $hl (enum.get $Token.punctuation.list_marker))))
            ;; `:=` and `|` precede a constructor
            (local.set $kind
              (i32.or
                (i32.and (i32.eq (local.get $rhs) (i32.const 1)) (i32.eq (local.get $c) (i32.const "|")))
                (i32.and
                  (i32.eq (local.get $rhs) (i32.const 2))
                  (i32.eq (i32.load16_u (local.get $lhs)) (i32.const ":=")))))))
        (if (i32.ge_u (local.get $expect) (i32.const 6))
          (then (local.set $expect (i32.add (i32.const 6) (local.get $kind)))))
        (if (i32.le_u (i32.sub (local.get $expect) (i32.const 1)) (i32.const 2))
          (then (local.set $expect (i32.const 0))))
        ;; bullets and focus braces keep the sentence start
        (if
          (i32.or
            (local.get $mid)
            (i32.eqz
              (i32.or
                (i32.eq (local.get $hl) (enum.get $Token.punctuation.list_marker))
                (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}"))))))
          (then (local.set $mid (i32.const 1))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
