(module
  (import "../common.wat")

  ;; Group order is the dispatch order in $silkWordHl below. `where` is
  ;; absent on purpose: the table hash sees only the first two bytes, the
  ;; last byte, and the length, which are identical for `while`, so
  ;; $silkWordHl matches `where` directly.
  (keyword-table $silkWords $mem.silkWords $mem.laterWordsFree
    (group $Token.keyword.declaration+256 "fn") ;; 1: declaration, next name is a function
    (group $Token.keyword.declaration+512 ;; 2: declaration, next name is a type
      "enum" "role" "type" "tuple" "union" "struct" "service" "interface")
    (group $Token.keyword.declaration+768 "let" "param") ;; 3: next name is a binding
    (group $Token.keyword.declaration "impl" "const" "effect") ;; 4: declaration
    (group $Token.keyword.import "import" "as") ;; 5: import
    (group $Token.keyword.control ;; 6: control
      "if" "for" "run" "else" "fail" "break" "match" "while" "return" "continue")
    (group $Token.keyword ;; 7: modifiers and contextual words
      "in" "mut" "pub" "drop" "move" "once" "extern" "export" "static" "typeof"
      "unsafe" "provides" "compileError")
    (group $Token.type.builtin ;; 8: primitive types
      "i8" "u8" "i16" "u16" "i32" "u32" "i64" "u64" "f32" "f64" "i128" "u128"
      "bool" "char" "isize" "usize" "never" "string")
    (group $Token.boolean "true" "false") ;; 9: booleans
    (group $Token.variable.special "self" "Self")) ;; 10: the receiver and its type

  ;; Token in the low byte; the high byte names the next-name capture:
  ;; 1 function, 2 type, 3 binding. -1 for an ordinary name.
  (func $silkWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $hl i32)
    (local.set $hl (keyword-table.value $silkWords (local.get $lhs) (local.get $rhs)))
    (if (i32.eq (local.get $hl) (i32.const -1))
      (then
        ;; the wide load stays inside the input slack, as in the table's own
        ;; compare
        (if
          (i32.and
            (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 5))
            (i64.eq
              (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffff))
              (i64.const "where")))
          (then (local.set $hl (enum.get $Token.keyword))))))
    (local.get $hl))

  ;; Contextual words stay identifiers unless the next token is the one the
  ;; Silk parser itself looks ahead for: `test fn`, `some<` (an opaque result),
  ;; `simd<` and `mask<` (vector types), `use 'a` (a callable's outer binder),
  ;; and `match place value`. $p is the first byte after the word's trailing
  ;; spaces. Returns the token, or -1 for an ordinary name.
  (func $silkContextualHl (param $lhs i32) (param $rhs i32) (param $p i32) (result i32)
    (local $n i32)
    (local $w i32)
    (local $pc i32)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    ;; the wide load stays inside the input slack, as in $silkWordHl
    (local.set $w (i32.load (local.get $lhs)))
    (local.set $pc (call $templateByte (local.get $p)))
    (if (i32.eq (local.get $n) (i32.const 4))
      (then
        (if
          (i32.and
            (i32.eq (local.get $w) (i32.const "test"))
            (i32.and
              (i32.eq (i32.load16_u (local.get $p)) (i32.const "fn"))
              (i32.and
                (i32.le_u (i32.add (local.get $p) (i32.const 2)) (global.get $end))
                (i32.eqz
                  (call $lexIsIdentContinue
                    (call $templateByte (i32.add (local.get $p) (i32.const 2))))))))
          (then (return (enum.get $Token.keyword))))
        (if (i32.eq (local.get $pc) (i32.const "<"))
          (then
            (if (i32.eq (local.get $w) (i32.const "some"))
              (then (return (enum.get $Token.keyword))))
            (if
              (i32.or
                (i32.eq (local.get $w) (i32.const "simd"))
                (i32.eq (local.get $w) (i32.const "mask")))
              (then (return (enum.get $Token.type.builtin))))))))
    (if
      (i32.and
        (i32.eq (local.get $n) (i32.const 3))
        (i32.and
          (i32.eq (i32.and (local.get $w) (i32.const 0xffffff)) (i32.const "use"))
          (i32.eq (local.get $pc) (i32.const 39))))
      (then (return (enum.get $Token.keyword))))
    (if
      (i32.and
        (i32.eq (local.get $n) (i32.const 5))
        (i32.and
          (i32.and
            (i32.eq (local.get $w) (i32.const "plac"))
            (i32.eq (i32.load8_u offset=4 (local.get $lhs)) (i32.const "e")))
          (i32.and
            (i32.gt_u (local.get $p) (local.get $rhs))
            (call $lexIsIdentStart (local.get $pc)))))
      (then (return (enum.get $Token.keyword))))
    (i32.const -1))

  (func $silkIsOp (param $c i32) (result i32)
    (byteset.get "!%&*+-/<=>?^|~" (local.get $c)))

  ;; Advance $ptr through a `"""` body to just past its closing quotes, or
  ;; to $end, emitting string ranges from $seg and escapes between them. $raw
  ;; bodies have no escapes. Returns 1 when the body closed. $hlSilk keeps an
  ;; open body in a checkpointed local, so a body crossing a chunk boundary
  ;; resumes with the same escape handling.
  (func $silkTripleBody (param $seg i32) (param $raw i32) (result i32)
    (local $closed i32)
    (block $done
      (loop $scan
        (global.set $ptr
          (if (result i32) (local.get $raw)
            (then (call $lexFindByte (global.get $ptr) (i32.const 34)))
            (else (call $lexFindEither (global.get $ptr) (i32.const 34) (i32.const 92)))))
        (if (i32.ge_u (global.get $ptr) (global.get $end))
          (then
            (global.set $ptr (global.get $end))
            (br $done)))
        (if (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 92))
          (then
            (drop (call $stringEscapeAt (local.get $seg)))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (if
          (i32.and
            (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const 34))
            (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const 34)))
          (then
            ;; both trailing quotes read below $end, so this cannot overshoot
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
            (local.set $closed (i32.const 1))
            (br $done)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (local.get $closed))

  ;; $expect names the capture of the next name: 1 function, 2 type,
  ;; 3 binding. $triple marks an open `"""` body. $member is 1 after `.`. $importCtx is 1 on an `import` line
  ;; before its member list, where names are module path segments. $parens
  ;; counts open parens, where `name:` is a parameter rather than a field.
  ;; All are checkpointed.
  (func $hlSilk
    (local $c i32)
    (local $c2 i32)
    (local $c3 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $pc i32)
    (local $kind i32)
    (local $hl i32)
    (local $expect i32)
    (local $member i32)
    (local $importCtx i32)
    (local $parens i32)
    (local $triple i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; a `"""` body left open by its opener or by the previous chunk:
        ;; $triple is 1 for an escaped body and 2 for a raw one
        (if
          (i32.and
            (i32.ne (local.get $triple) (i32.const 0))
            (i32.lt_u (global.get $ptr) (global.get $end)))
          (then
            (if
              (call $silkTripleBody
                (global.get $ptr)
                (i32.eq (local.get $triple) (i32.const 2)))
              (then (local.set $triple (i32.const 0))))
            (br $next)))
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        ;; an import path ends at its line break
        (if
          (i32.lt_u
            (call $scanFindSpecial
              (local.get $gap)
              (global.get $ptr)
              (i32.const 10)
              (i32.const 0)
              (i32.const 1))
            (global.get $ptr))
          (then (local.set $importCtx (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $templateByte (i32.add (global.get $ptr) (i32.const 2))))

        ;; `///` documents the next declaration and `//!` the module;
        ;; `////` is an ordinary comment
        (if
          (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment
              (i32.const 2)
              (select
                (enum.get $Token.comment.doc)
                (enum.get $Token.comment)
                (i32.or
                  (i32.eq (local.get $c3) (i32.const "!"))
                  (i32.and
                    (i32.eq (local.get $c3) (i32.const "/"))
                    (i32.ne
                      (call $templateByte (i32.add (global.get $ptr) (i32.const 3)))
                      (i32.const "/"))))))
            (br $next)))

        ;; `b"` byte strings and `r"` raw strings, both with `"""` forms
        (if
          (i32.and
            (i32.or (i32.eq (local.get $c) (i32.const "b")) (i32.eq (local.get $c) (i32.const "r")))
            (i32.eq (local.get $c2) (i32.const 34)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if
              (i32.and
                (i32.eq (local.get $c3) (i32.const 34))
                (i32.eq
                  (call $templateByte (i32.add (global.get $ptr) (i32.const 2)))
                  (i32.const 34)))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (local.set $triple
                  (select (i32.const 2) (i32.const 1) (i32.eq (local.get $c) (i32.const "r")))))
              (else
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (if (i32.eq (local.get $c) (i32.const "r"))
                  (then (call $lexRawString (i32.const 34) (i32.const 0) (enum.get $Token.string)))
                  (else (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string))))))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (if
              (i32.and (i32.eq (local.get $c2) (i32.const 34)) (i32.eq (local.get $c3) (i32.const 34)))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (local.set $triple (i32.const 1)))
              (else (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string))))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))

        ;; a lifetime `'a` unless a closing quote or escape makes a character
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (local.set $p (i32.add (global.get $ptr) (i32.const 1)))
            (if (call $lexIsIdentStart (local.get $c2))
              (then
                (block $lifeDone
                  (loop $life
                    (br_if $lifeDone
                      (i32.eqz (call $lexIsIdentContinue (call $templateByte (local.get $p)))))
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br $life)))))
            (if
              (i32.and
                (i32.gt_u (local.get $p) (i32.add (global.get $ptr) (i32.const 1)))
                (i32.and
                  (i32.ne (call $templateByte (local.get $p)) (i32.const 39))
                  (i32.ne (call $templateByte (local.get $p)) (i32.const 92))))
              (then
                (global.set $ptr (local.get $p))
                (call $emitTok (enum.get $Token.label) (local.get $lhs) (global.get $ptr)))
              (else (call $lexString (i32.const 39) (i32.const 0) (enum.get $Token.string))))
            (local.set $member (i32.const 0))
            (br $next)))

        ;; a directive such as `@inlineAlways` or `@features("aes")`
        (if
          (i32.and (i32.eq (local.get $c) (i32.const "@")) (call $lexIsIdentStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        ;; an identifier: an ASCII letter or `_`
        (if
          (i32.or
            (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
            (i32.eq (local.get $c) (i32.const "_")))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $pc (call $templateByte (local.get $p)))
            (local.set $kind
              (select
                (i32.const -1)
                (call $silkWordHl (local.get $lhs) (local.get $rhs))
                (local.get $member)))
            ;; a contextual word, unless it names a binding or a member
            (if
              (i32.and
                (i32.eq (local.get $kind) (i32.const -1))
                (i32.eqz
                  (i32.or (i32.or (local.get $member) (local.get $expect)) (local.get $importCtx))))
              (then
                (local.set $kind
                  (call $silkContextualHl (local.get $lhs) (local.get $rhs) (local.get $p)))))
            ;; an import path keeps only `as` as a keyword
            (if
              (i32.and
                (local.get $importCtx)
                (i32.ne
                  (i32.and (local.get $kind) (i32.const 255))
                  (enum.get $Token.keyword.import)))
              (then (local.set $kind (i32.const -1))))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                ;; modifiers such as `mut` keep a pending capture
                (if (i32.shr_u (local.get $kind) (i32.const 8))
                  (then (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8)))))
                (if
                  (i32.and
                    (i32.eq (local.get $hl) (enum.get $Token.keyword.import))
                    (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 6)))
                  (then (local.set $importCtx (i32.const 1)))))
              (else
                (if (local.get $importCtx)
                  (then (local.set $hl (enum.get $Token.namespace)))
                  (else
                    (if (local.get $expect)
                      (then
                        (local.set $hl
                          (select
                            (enum.get $Token.function.definition)
                            (select
                              (enum.get $Token.type)
                              (enum.get $Token.variable)
                              (i32.eq (local.get $expect) (i32.const 2)))
                            (i32.eq (local.get $expect) (i32.const 1))))
                        (local.set $expect (i32.const 0)))
                      (else
                        (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                          (then (local.set $hl (enum.get $Token.constant)))
                          (else
                            (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                              ;; a capitalized member names an enum member or
                              ;; union variant: `TokenKind.Comma`
                              (then
                                (local.set $hl
                                  (select
                                    (enum.get $Token.constructor)
                                    (enum.get $Token.type)
                                    (local.get $member))))
                              (else
                                (if (i32.eq (local.get $pc) (i32.const "("))
                                  (then
                                    (local.set $hl
                                      (select
                                        (enum.get $Token.function.method)
                                        (enum.get $Token.function)
                                        (local.get $member))))
                                  (else
                                    (if (local.get $member)
                                      (then (local.set $hl (enum.get $Token.property)))
                                      (else
                                        ;; `name:` is a parameter inside parens
                                        ;; and a field elsewhere
                                        (if
                                          (i32.and
                                            (i32.eq (local.get $pc) (i32.const ":"))
                                            (i32.ne
                                              (call $templateByte
                                                (i32.add (local.get $p) (i32.const 1)))
                                              (i32.const ":")))
                                          (then
                                            (local.set $hl
                                              (select
                                                (enum.get $Token.variable.parameter)
                                                (enum.get $Token.property)
                                                (local.get $parens))))
                                          (else
                                            (local.set $hl
                                              (enum.get $Token.variable))))))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))

        ;; a number, a duration such as `1h30m`, or a tuple index `pair.0`
        (if (call $lexIsDigit (local.get $c))
          (then
            (if (local.get $member)
              (then
                (block $indexDone
                  (loop $index
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br_if $index (call $lexIsDigit (call $templateByte (global.get $ptr)))))))
              (else (call $lexScanNumber)))
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))

        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (if (i32.eq (local.get $c) (i32.const "("))
              (then (local.set $parens (i32.add (local.get $parens) (i32.const 1)))))
            (if
              (i32.and
                (i32.eq (local.get $c) (i32.const ")"))
                (i32.gt_u (local.get $parens) (i32.const 0)))
              (then (local.set $parens (i32.sub (local.get $parens) (i32.const 1)))))
            ;; a brace opens or closes a body at the top level of parens
            (if
              (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))
              (then
                (local.set $importCtx (i32.const 0))
                (if (i32.eq (local.get $c) (i32.const "{"))
                  (then (local.set $parens (i32.const 0))))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const ","))
            (i32.or (i32.eq (local.get $c) (i32.const ";")) (i32.eq (local.get $c) (i32.const ":"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter)
              (local.get $lhs)
              (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))
        ;; `.` selects a member; `..` and `...` are operators
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (if (i32.eq (local.get $c2) (i32.const "."))
              (then
                (global.set $ptr
                  (i32.add
                    (global.get $ptr)
                    (select (i32.const 3) (i32.const 2) (i32.eq (local.get $c3) (i32.const ".")))))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (local.set $member (i32.const 0)))
              (else
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok
                  (enum.get $Token.punctuation.delimiter)
                  (local.get $lhs)
                  (global.get $ptr))
                ;; module path segments are not members
                (local.set $member (i32.eqz (local.get $importCtx)))))
            (local.set $expect (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (call $silkIsOp (local.get $c))
          (then
            (block $opDone
              (loop $op
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br_if $opDone (i32.eqz (call $silkIsOp (call $templateByte (global.get $ptr)))))
                ;; a comment may follow an operator directly
                (br_if $opDone
                  (i32.and
                    (i32.eq (call $templateByte (global.get $ptr)) (i32.const "/"))
                    (i32.eq
                      (call $templateByte (i32.add (global.get $ptr) (i32.const 1)))
                      (i32.const "/"))))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))

        (global.set $ptr
          (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (br $next))))
)
