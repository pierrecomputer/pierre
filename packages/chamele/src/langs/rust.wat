(module
  (import "../common.wat")

  (func $rustByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $rustWordHl below. `where` is absent
  ;; on purpose: the table hash sees only the first two bytes, the last byte,
  ;; and the length, which are identical for `while`, so the two words can
  ;; never share a table and `where` is matched directly in $rustWordHl.
  (keyword-table $rustWords $mem.rustWords $mem.rustWords+640
    (group $Token.keyword.declaration+256 "fn") ;; 1: declaration, next name is a function
    (group $Token.keyword.declaration+512 ;; 2: declaration, next name is a type
      "mod" "type" "enum" "trait" "union" "struct")
    (group $Token.keyword.import "use" "crate" "super" "extern") ;; 3: import
    (group $Token.keyword.control ;; 4: control
      "if" "for" "else" "loop" "await" "break" "match" "while" "return" "continue")
    (group $Token.keyword.declaration "let" "impl" "const" "static") ;; 5: declaration
    (group $Token.keyword "dyn" "mut" "pub" "ref" "move" "async" "unsafe") ;; 6: bare keywords
    (group $Token.keyword.operator "as" "in") ;; 7: word operators
    (group $Token.type.builtin ;; 8: primitive types
      "i8" "u8" "i16" "u16" "i32" "u32" "i64" "u64" "f32" "f64"
      "str" "bool" "char" "isize" "usize")
    (group $Token.boolean "true" "false") ;; 9: booleans
    (group $Token.variable.special "self" "Self")) ;; 10: the receiver value and its type spelling

  ;; Token in the low byte; bit 8 expects a function name and bit 9 a type.
  (func $rustWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $hl i32)
    (local.set $hl (keyword-table.value $rustWords (local.get $lhs) (local.get $rhs)))
    (if (i32.eq (local.get $hl) (i32.const -1))
      (then
        ;; the one word the table cannot hold; the wide load stays inside the
        ;; input slack, as in the table's own compare
        (if (i32.and
              (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 5))
              (i64.eq
                (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffff))
                (i64.const "where")))
          (then (return (enum.get $Token.keyword))))))
    (local.get $hl))

  (func $rustRawStart (param $prefix i32) (result i32)
    (local $p i32)
    (local.set $p (i32.add (global.get $ptr) (local.get $prefix)))
    (block $done
      (loop $hash
        (br_if $done (i32.ne (call $rustByte (local.get $p)) (i32.const "#")))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $hash)))
    (i32.eq (call $rustByte (local.get $p)) (i32.const 34)))

  ;; The opener of a raw string at $ptr - the `r`/`br`/`cr` prefix, the
  ;; hashes, and the quote - emitted as string. Returns the hash count plus
  ;; one: $hlRust keeps that in a checkpointed local while the body is open,
  ;; so a body crossing a chunk boundary resumes from the local rather than
  ;; from the 32-byte stream delimiter, which cannot hold long hash runs.
  (func $rustRawOpen (param $prefix i32) (result i32)
    (local $lhs i32) (local $hashes i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (local.get $prefix)))
    (block $done
      (loop $hash
        (br_if $done (i32.ne (call $rustByte (global.get $ptr)) (i32.const "#")))
        (local.set $hashes (i32.add (local.get $hashes) (i32.const 1)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $hash)))
    ;; $rustRawStart already proved the byte here is the opening quote, so it
    ;; is below $end and this cursor lands at most on $end
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
    (i32.add (local.get $hashes) (i32.const 1)))

  ;; Advance $ptr through a raw string body to just past its closing quote
  ;; and $hashes hashes, or to $end: hop between quotes with SIMD and count
  ;; hashes only at each candidate. Returns 1 when the body closed.
  (func $rustRawBody (param $hashes i32) (result i32)
    (local $q i32) (local $seen i32)
    (block $done
      (loop $scan
        (global.set $ptr (call $lexFindByte (global.get $ptr) (i32.const 34)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $q (i32.add (global.get $ptr) (i32.const 1)))
        (local.set $seen (i32.const 0))
        (block $matchDone
          (loop $match
            (br_if $matchDone (i32.ge_u (local.get $seen) (local.get $hashes)))
            (br_if $matchDone (i32.ne (call $rustByte (local.get $q)) (i32.const "#")))
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

  (func $rustIsOp (param $c i32) (result i32)
    (byteset.get "!%&*+-/<=>^|" (local.get $c)))

  (func $hlRust
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $kind i32) (local $hl i32) (local $expect i32) (local $member i32) (local $attr i32)
    (local $rawOpen i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; a raw string body left open by its opener or by the previous
        ;; chunk: $rawOpen is its hash count plus one until the body closes
        (if (i32.and
              (i32.ne (local.get $rawOpen) (i32.const 0))
              (i32.lt_u (global.get $ptr) (global.get $end)))
          (then
            (local.set $lhs (global.get $ptr))
            (if (call $rustRawBody (i32.sub (local.get $rawOpen) (i32.const 1)))
              (then (local.set $rawOpen (i32.const 0))))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $rustByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $rustByte (i32.add (global.get $ptr) (i32.const 2))))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.or (i32.eq (local.get $c3) (i32.const "/")) (i32.eq (local.get $c3) (i32.const "!")))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexNestedBlockComment (i32.const "/*") (i32.const "*/") (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.or (i32.eq (local.get $c3) (i32.const "*")) (i32.eq (local.get $c3) (i32.const "!")))))
            (br $next)))

        (if (i32.and
              (i32.or (i32.eq (local.get $c) (i32.const "b")) (i32.eq (local.get $c) (i32.const "c")))
              (i32.and (i32.eq (local.get $c2) (i32.const "r")) (call $rustRawStart (i32.const 2))))
          (then
            (local.set $rawOpen (call $rustRawOpen (i32.const 2)))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "r")) (call $rustRawStart (i32.const 1)))
          (then
            (local.set $rawOpen (call $rustRawOpen (i32.const 1)))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.and
              (i32.or (i32.eq (local.get $c) (i32.const "b")) (i32.eq (local.get $c) (i32.const "c")))
              (i32.or (i32.eq (local.get $c2) (i32.const 34)) (i32.eq (local.get $c2) (i32.const 39))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (call $lexString (local.get $c2) (i32.const 0) (enum.get $Token.string))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string)) (br $next)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (local.set $p (i32.add (global.get $ptr) (i32.const 1)))
            (block $lifeDone
              (loop $life
                (br_if $lifeDone (i32.eqz (call $lexIsIdentContinue (call $rustByte (local.get $p)))))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $life)))
            (if (i32.and (i32.gt_u (local.get $p) (i32.add (global.get $ptr) (i32.const 1)))
                          (i32.ne (call $rustByte (local.get $p)) (i32.const 39)))
              (then
                (global.set $ptr (local.get $p))
                (call $emitTok (enum.get $Token.label) (local.get $lhs) (global.get $ptr)))
              (else (call $lexString (i32.const 39) (i32.const 0) (enum.get $Token.string))))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.and (i32.eq (local.get $c) (i32.const "#"))
              (i32.or (i32.eq (local.get $c2) (i32.const "["))
                      (i32.and (i32.eq (local.get $c2) (i32.const "!")) (i32.eq (local.get $c3) (i32.const "[")))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 2) (i32.const 1)
              (i32.eq (local.get $c2) (i32.const "!")))))
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (local.set $attr (i32.const 1))
            (br $next)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            ;; a pending fn head outside its type parameters expects only the
            ;; opening paren; any other identifier here is stale context
            (if (i32.and (global.get $sigFnPend) (i32.eqz (global.get $sigFnAngle)))
              (then (global.set $sigFnPend (i32.const 0))))
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (if (local.get $attr)
              (then (local.set $hl (enum.get $Token.attribute)) (local.set $attr (i32.const 0)))
              (else
                (local.set $kind (call $rustWordHl (local.get $lhs) (local.get $rhs)))
                (if (i32.ge_s (local.get $kind) (i32.const 0))
                  (then
                    (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                    (if (i32.shr_u (local.get $kind) (i32.const 8))
                      (then (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8))))))
                  (else
                    (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
                    (if (local.get $expect)
                      (then
                        (local.set $hl (select (enum.get $Token.function.definition) (enum.get $Token.type)
                          (i32.eq (local.get $expect) (i32.const 1))))
                        ;; an fn name arms the parameter machine for the paren
                        ;; after its optional type-parameter angles
                        (if (i32.eq (local.get $expect) (i32.const 1))
                          (then
                            (global.set $sigFnPend (i32.const 1))
                            (global.set $sigFnAngle (i32.const 0))))
                        (local.set $expect (i32.const 0)))
                      (else
                        ;; a macro name ends in `!`, but `a != b` is an operator
                        (if (i32.and
                              (i32.eq (call $rustByte (local.get $p)) (i32.const "!"))
                              (i32.ne (call $rustByte (i32.add (local.get $p) (i32.const 1))) (i32.const "=")))
                          (then (local.set $hl (enum.get $Token.function)))
                          (else
                            (if (i32.eq (call $rustByte (local.get $p)) (i32.const "("))
                              (then (local.set $hl (select (enum.get $Token.function.method) (enum.get $Token.function) (local.get $member))))
                              (else
                                (if (local.get $member)
                                  (then
                                    ;; after `::` a capitalised name is a type
                                    ;; - or a SCREAMING_CASE constant - rather
                                    ;; than a field; after `.` it is a field
                                    (if (i32.and
                                          (i32.eq (local.get $member) (i32.const 2))
                                          (i32.le_u (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25)))
                                      (then
                                        (local.set $hl (select (enum.get $Token.constant) (enum.get $Token.type)
                                          (call $lexIsConstCase (local.get $lhs) (local.get $rhs)))))
                                      (else (local.set $hl (enum.get $Token.property)))))
                                  (else
                                    ;; a name in parameter position at the top
                                    ;; level of a marked fn list with a `:`
                                    ;; annotation ahead - never `::` - is a
                                    ;; parameter (Zed's parameter capture)
                                    (if (i32.and
                                          (i32.and (call $sigActive) (global.get $sigPattern))
                                          (i32.and
                                            (i32.eqz (global.get $sigObscure))
                                            (i32.and
                                              (i32.eq (call $rustByte (local.get $p)) (i32.const ":"))
                                              (i32.ne (call $rustByte (i32.add (local.get $p) (i32.const 1))) (i32.const ":")))))
                                      (then (local.set $hl (enum.get $Token.variable.parameter)))
                                      (else
                                        (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                                          (then (local.set $hl (enum.get $Token.constant)))
                                          (else
                                            (if (i32.le_u (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25))
                                              (then (local.set $hl (enum.get $Token.type)))
                                              (else (local.set $hl (enum.get $Token.variable))))))))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            ;; only a `mut` binding modifier keeps the next name in position
            (global.set $sigPattern (i32.and
              (global.get $sigPattern)
              (i32.and
                (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 3))
                (i32.eq (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff)) (i32.const "mut")))))
            (local.set $member (i32.const 0))
            (br $next)))

        ;; a declaration keyword names only the identifier right after it;
        ;; any other token below - `fn(i32)` types, punctuation, operators -
        ;; drops the pending capture so it cannot leak onto a later name
        (if (i32.or (call $lexIsDigit (local.get $c))
                    (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))

        (if (byteset.get "()[]{}" (local.get $c))
          (then
            ;; parameter machine: a paren may open the armed fn list and puts
            ;; the next name in parameter position; other brackets inside a
            ;; marked list obscure its top level
            (if (i32.eq (local.get $c) (i32.const "("))
              (then
                (global.set $sigParens (i32.add (global.get $sigParens) (i32.const 1)))
                (if (i32.eqz (global.get $sigFnAngle))
                  (then
                    (if (global.get $sigFnPend) (then (call $sigMark)))
                    (global.set $sigFnPend (i32.const 0))))
                (global.set $sigPattern (i32.const 1)))
              (else
                (global.set $sigPattern (i32.const 0))
                (if (i32.eq (local.get $c) (i32.const ")"))
                  (then
                    (if (call $sigActive) (then (call $sigUnmark)))
                    (if (i32.gt_u (global.get $sigParens) (i32.const 0))
                      (then (global.set $sigParens
                        (i32.sub (global.get $sigParens) (i32.const 1))))))
                  (else
                    (if (i32.and (global.get $sigFnPend) (i32.eqz (global.get $sigFnAngle)))
                      (then (global.set $sigFnPend (i32.const 0))))
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
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (if (i32.eqz (local.get $attr)) (then (local.set $member (i32.const 0))))
            (local.set $expect (i32.const 0))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            ;; a comma returns to parameter position; a top-level `;` proves
            ;; the marked list was not a parameter list after all
            (global.set $sigPattern (i32.eq (local.get $c) (i32.const ",")))
            (if (i32.and
                  (i32.eq (local.get $c) (i32.const ";"))
                  (i32.and (call $sigActive) (i32.eqz (global.get $sigObscure))))
              (then (call $sigUnmark)))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 2) (i32.const 1)
              (i32.eq (local.get $c2) (i32.const ":")))))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            ;; `::` puts the next name in path position, two, as opposed to
            ;; the field position, one, after `.`
            (local.set $member (select (i32.const 2) (i32.const 0) (i32.eq (local.get $c2) (i32.const ":"))))
            (local.set $expect (i32.const 0))
            (global.set $sigPattern (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 2) (i32.const 1)
              (i32.eq (local.get $c2) (i32.const ".")))))
            (if (i32.and (i32.eq (local.get $c2) (i32.const "."))
                         (i32.eq (call $rustByte (global.get $ptr)) (i32.const "=")))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok (select (enum.get $Token.operator) (enum.get $Token.punctuation.delimiter)
              (i32.eq (local.get $c2) (i32.const "."))) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.ne (local.get $c2) (i32.const ".")))
            (local.set $expect (i32.const 0))
            (global.set $sigPattern (i32.const 0))
            (br $next)))

        (if (call $rustIsOp (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.or (i32.eq (local.get $c2) (i32.const "="))
                        (i32.and (i32.eq (local.get $c) (local.get $c2))
                          (i32.or (i32.eq (local.get $c) (i32.const "&"))
                                  (i32.or (i32.eq (local.get $c) (i32.const "|"))
                                          (i32.or (i32.eq (local.get $c) (i32.const "<"))
                                                  (i32.eq (local.get $c) (i32.const ">")))))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.and (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const ">")))
                             (i32.eq (call $rustByte (global.get $ptr)) (i32.const "=")))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            ;; a pending fn head rides `<`/`>` type-parameter operators
            (if (global.get $sigFnPend)
              (then (call $sigAngleOps (local.get $lhs) (global.get $ptr))))
            (global.set $sigPattern (i32.const 0))
            (br $next)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (local.set $expect (i32.const 0))
        (br $next))))
)
