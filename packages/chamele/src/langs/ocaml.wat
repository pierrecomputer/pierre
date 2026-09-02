(module
  (import "../common.wat")

  (func $mlByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; group order is the dispatch order in $mlWordHl below
  (keyword-table $mlWords $mem.ocamlWords $mem.ocamlWords+1536 16 512
    (group ;; 1: control
      "do" "if" "of" "to" "for" "try" "done" "else" "then" "when" "with"
      "begin" "match" "while" "downto" "assert" "function" "lazy")
    (group "let" "and" "rec" "nonrec") ;; 2: value bindings, next name may be a function
    (group "type")                     ;; 3: type declarations
    (group "module" "functor" "sig" "struct" "open" "include") ;; 4: modules, next name is a module
    (group ;; 5: other declarations
      "in" "as" "val" "end" "fun" "new" "class" "object" "method" "mutable"
      "private" "virtual" "inherit" "external" "exception" "constraint"
      "initializer")
    (group ;; 6: word operators
      "or" "mod" "asr" "lsl" "lsr" "lor" "land" "lxor")
    (group ;; 7: built-in types
      "int" "exn" "ref" "char" "bool" "list" "unit" "array" "bytes" "float"
      "option" "string")
    (group "true" "false")) ;; 8: booleans

  ;; Token in the low byte; bit 8 marks a value binding whose next name may
  ;; be a function, bit 9 a type declaration, bit 10 a module head. -1 means
  ;; an ordinary identifier.
  (func $mlWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $g i32)
    (local.set $g (keyword-table.get $mlWords (local.get $lhs) (local.get $rhs)))
    (if (i32.eqz (local.get $g)) (then (return (i32.const -1))))
    (if (i32.eq (local.get $g) (i32.const 1))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.eq (local.get $g) (i32.const 2))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 256)))))
    (if (i32.eq (local.get $g) (i32.const 3))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 512)))))
    (if (i32.eq (local.get $g) (i32.const 4))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 1024)))))
    (if (i32.eq (local.get $g) (i32.const 5))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.eq (local.get $g) (i32.const 6))
      (then (return (enum.get $Token.keyword.operator))))
    (if (i32.eq (local.get $g) (i32.const 7))
      (then (return (enum.get $Token.type.builtin))))
    (enum.get $Token.boolean))

  ;; A character literal starts at the tick $p when a single character - an
  ;; escape, or one code point - sits between it and a closing tick. Any
  ;; other tick begins a type variable such as 'a or ends a name like x'.
  (func $mlIsCharLiteral (param $p i32) (result i32)
    (local $e i32)
    (if (i32.ge_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
      (then (return (i32.const 0))))
    (if (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const 92))
      (then (return (i32.const 1))))
    (local.set $e (call $utf8SpanEnd
      (i32.add (local.get $p) (i32.const 2)) (global.get $end)))
    (i32.and
      (i32.lt_u (local.get $e) (global.get $end))
      (i32.eq (i32.load8_u (local.get $e)) (i32.const 39))))

  (func $mlIsSymbol (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "!")) (i32.eq (local.get $c) (i32.const "$")))
        (i32.or (i32.eq (local.get $c) (i32.const "%")) (i32.eq (local.get $c) (i32.const "&"))))
      (i32.or
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $c) (i32.const "+")))
          (i32.or (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c) (i32.const "/"))))
        (i32.or
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const "=")))
            (i32.or (i32.eq (local.get $c) (i32.const ">")) (i32.eq (local.get $c) (i32.const "@"))))
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const "^")) (i32.eq (local.get $c) (i32.const "|")))
            (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "~")) (i32.eq (local.get $c) (i32.const ":")))
              (i32.eq (local.get $c) (i32.const "?"))))))))

  ;; $expect is the pending capture: 1 after `let`, `and`, or `rec` - the
  ;; name is a function when arguments follow it - 2 after `type`, whose
  ;; name follows any `'a` parameters, and 3 after a module keyword.
  ;; $typeMode is 1 inside a type annotation or constructor argument list,
  ;; where lowercase names are types; $member is 1 after `.` and 2 after a
  ;; module's `.`; $afterValue is 1 after a value - a name, a literal, or
  ;; a closer - so the head of an application can be told from its
  ;; arguments. All are checkpointed.
  (func $hlOcaml
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32) (local $q i32)
    (local $kind i32) (local $hl i32) (local $expect i32) (local $member i32)
    (local $typeMode i32) (local $n i32) (local $afterValue i32) (local $lastModule i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $mlByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $mlByte (i32.add (global.get $ptr) (i32.const 2))))

        ;; `(* ... *)` nests; `(** ... *)` documents
        (if (i32.and (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexNestedBlockComment (i32.const "(*") (i32.const "*)") (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.and (i32.eq (local.get $c3) (i32.const "*"))
                (i32.ne (call $mlByte (i32.add (global.get $ptr) (i32.const 3))) (i32.const ")")))))
            (br $next)))

        ;; strings span lines; `{id|...|id}` is a quoted string with no escapes
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexString (i32.const 34) (i32.const 1) (enum.get $Token.string))
            (local.set $member (i32.const 0))
            (local.set $afterValue (i32.const 1))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "{"))
              (i32.or (i32.eq (local.get $c2) (i32.const "|"))
                (i32.and (i32.le_u (i32.sub (local.get $c2) (i32.const "a")) (i32.const 25))
                  (i32.eq (call $mlByte (call $mlIdEnd (i32.add (global.get $ptr) (i32.const 1)))) (i32.const "|")))))
          (then
            ;; the closer is `|` + id + `}`: build it in the delimiter region
            (local.set $q (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $p (call $mlIdEnd (local.get $q)))
            (local.set $n (i32.sub (local.get $p) (local.get $q)))
            (if (i32.gt_u (local.get $n) (i32.const 30))
              (then (local.set $n (i32.const 30))))
            (i32.store8 (i32.const $mem.streamDelimiter) (i32.const "|"))
            (memory.copy (i32.const $mem.streamDelimiter+1) (local.get $q) (local.get $n))
            (i32.store8 (i32.add (i32.const $mem.streamDelimiter+1) (local.get $n)) (i32.const "}"))
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (call $mlQuotedBody (i32.add (local.get $n) (i32.const 2)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (call $streamSetFixed (i32.const $mem.streamDelimiter) (i32.add (local.get $n) (i32.const 2))
              (enum.get $Token.string))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const 39)) (call $mlIsCharLiteral (global.get $ptr)))
          (then
            (call $lexString (i32.const 39) (i32.const 0) (enum.get $Token.string))
            (local.set $member (i32.const 0))
            (local.set $afterValue (i32.const 1))
            (br $next)))
        ;; `'a` type variables
        (if (i32.and (i32.eq (local.get $c) (i32.const 39)) (call $lexIsIdentStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanIdentRun (i32.const 39))
            (call $emitTok (enum.get $Token.type) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        ;; `` `Variant `` polymorphic variants
        (if (i32.and (i32.eq (local.get $c) (i32.const "`")) (call $lexIsIdentStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.variant) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        ;; `~label`, `~label:`, `?opt` argument labels
        (if (i32.and
              (i32.or (i32.eq (local.get $c) (i32.const "~")) (i32.eq (local.get $c) (i32.const "?")))
              (call $lexIsIdentStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.variable.parameter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        ;; `[@attr]`, `[@@attr]`, `[@@@attr]`, `[%ext]`, `[%%ext]`
        (if (i32.and (i32.eq (local.get $c) (i32.const "["))
              (i32.or (i32.eq (local.get $c2) (i32.const "@")) (i32.eq (local.get $c2) (i32.const "%"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (block $marksDone
              (loop $marks
                (br_if $marksDone (i32.ne (call $mlByte (global.get $ptr)) (local.get $c2)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $marks)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (local.set $lhs (global.get $ptr))
            (call $scanIdentRun (i32.const "."))
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            ;; primes continue a name: x', f''
            (call $scanIdentRun (i32.const 39))
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $kind (select (i32.const -1)
              (call $mlWordHl (local.get $lhs) (local.get $rhs))
              (local.get $member)))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8)))
                (if (i32.eq (local.get $expect) (i32.const 4))
                  (then (local.set $expect (i32.const 3))))
                ;; `of` and `:` open a type; `in`, `=`, and the rest close it
                (local.set $typeMode (i32.and
                  (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 2))
                  (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "of")))))
              (else
                (if (i32.le_u (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25))
                  (then
                    ;; `Foo.bar` names a module, a bare `Foo` a constructor
                    (local.set $lastModule (i32.eq (call $mlByte (local.get $rhs)) (i32.const ".")))
                    (local.set $hl (select (enum.get $Token.namespace) (enum.get $Token.constructor)
                      (i32.or (local.get $lastModule) (i32.eq (local.get $expect) (i32.const 3)))))
                    (if (i32.eq (local.get $expect) (i32.const 3))
                      (then (local.set $expect (i32.const 0)))))
                  (else
                    (if (i32.eq (local.get $expect) (i32.const 1))
                      (then
                        ;; `let f x =` defines a function, `let x =` a value;
                        ;; `let open` and `let rec` keep the head open
                        (local.set $hl (select (enum.get $Token.function.definition) (enum.get $Token.variable)
                          (i32.or
                            (call $lexIsIdentStart (call $mlByte (local.get $p)))
                            (i32.or
                              (i32.eq (call $mlByte (local.get $p)) (i32.const "("))
                              (i32.or
                                (i32.eq (call $mlByte (local.get $p)) (i32.const "~"))
                                (i32.eq (call $mlByte (local.get $p)) (i32.const "?")))))))
                        (local.set $expect (i32.const 0)))
                      (else
                        (if (i32.eq (local.get $expect) (i32.const 2))
                          (then
                            (local.set $hl (enum.get $Token.type))
                            (local.set $expect (i32.const 0)))
                          (else
                            (if (local.get $typeMode)
                              (then (local.set $hl (enum.get $Token.type)))
                              (else
                                (if (local.get $member)
                                  (then (local.set $hl (select
                                    (enum.get $Token.function) (enum.get $Token.property)
                                    (i32.eq (local.get $member) (i32.const 2)))))
                                  (else
                                    ;; the head of an application - a name
                                    ;; before an argument that no value
                                    ;; precedes - is the function applied
                                    (local.set $hl (select (enum.get $Token.function) (enum.get $Token.variable)
                                      (i32.and
                                        (i32.eqz (local.get $afterValue))
                                        (call $mlIsArgStart (call $mlByte (local.get $p))))))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (local.set $afterValue (i32.or
              (i32.or
                (i32.eq (local.get $hl) (enum.get $Token.variable))
                (i32.eq (local.get $hl) (enum.get $Token.function)))
              (i32.or
                (i32.eq (local.get $hl) (enum.get $Token.constructor))
                (i32.eq (local.get $hl) (enum.get $Token.property)))))
            (br $next)))

        (if (i32.or (call $lexIsDigit (local.get $c))
                    (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $afterValue (i32.const 1))
            (br $next)))

        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const ")")))
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "]")))
                (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $afterValue (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const ")")) (i32.eq (local.get $c) (i32.const "]")))
              (i32.eq (local.get $c) (i32.const "}"))))
            (if (i32.or (i32.eq (local.get $c) (i32.const ")")) (i32.eq (local.get $c) (i32.const "]")))
              (then (local.set $typeMode (i32.const 0))))
            (if (i32.eq (local.get $c) (i32.const "("))
              (then (local.set $expect (i32.const 0))))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 2) (i32.const 1)
              (i32.and (i32.eq (local.get $c) (i32.const ";")) (i32.eq (local.get $c2) (i32.const ";"))))))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $afterValue (i32.const 0))
            (local.set $typeMode (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))
        ;; `.` names a field, `.(` an array index, `Foo.` a module member
        (if (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.ne (local.get $c2) (i32.const ".")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            ;; a member of a module is a function when an argument follows
            (local.set $member (select (i32.const 2) (i32.const 1) (local.get $lastModule)))
            (if (i32.eq (local.get $member) (i32.const 2))
              (then
                (local.set $p (call $lexSkipSpaceAt (call $mlIdEnd (global.get $ptr))))
                (if (i32.eqz (call $mlIsArgStart (call $mlByte (local.get $p))))
                  (then (local.set $member (i32.const 1))))))
            (local.set $afterValue (i32.const 0))
            (br $next)))

        (if (call $mlIsSymbol (local.get $c))
          (then
            (block $symbolDone
              (loop $symbol
                (br_if $symbolDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (br_if $symbolDone (i32.eqz (i32.or
                  (call $mlIsSymbol (i32.load8_u (global.get $ptr)))
                  (i32.eq (i32.load8_u (global.get $ptr)) (i32.const ".")))))
                ;; a comment opener ends the run
                (br_if $symbolDone (i32.and
                  (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "("))
                  (i32.eq (call $mlByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "*"))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $symbol)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $n (i32.sub (global.get $ptr) (local.get $lhs)))
            ;; `:` opens a type annotation, `->` keeps it, `=` and `|` end
            ;; it; `::` is the cons operator
            (if (i32.eq (local.get $n) (i32.const 1))
              (then
                (if (i32.eq (local.get $c) (i32.const ":"))
                  (then (local.set $typeMode (i32.const 1))))
                (if (i32.or (i32.eq (local.get $c) (i32.const "=")) (i32.eq (local.get $c) (i32.const "|")))
                  (then
                    (local.set $typeMode (i32.const 0))
                    (local.set $expect (i32.const 0))))))
            (if (i32.and (i32.eq (local.get $n) (i32.const 2)) (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "::")))
              (then (local.set $typeMode (i32.const 0))))
            (local.set $member (i32.const 0))
            (local.set $afterValue (i32.const 0))
            (br $next)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (br $next))))

  ;; whether $c can begin an argument: a name, a literal, a paren, a label,
  ;; a polymorphic variant, or a record
  (func $mlIsArgStart (param $c i32) (result i32)
    (i32.or
      (i32.or (call $lexIsIdentStart (local.get $c)) (call $lexIsDigit (local.get $c)))
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const "[")))
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const "~")))
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const "`")) (i32.eq (local.get $c) (i32.const "{")))
            (i32.eq (local.get $c) (i32.const "?")))))))

  ;; the end of the lowercase identifier run at $p
  (func $mlIdEnd (param $p i32) (result i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $done (i32.eqz (i32.or
          (i32.le_u (i32.sub (i32.load8_u (local.get $p)) (i32.const "a")) (i32.const 25))
          (i32.eq (i32.load8_u (local.get $p)) (i32.const "_")))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (local.get $p))

  ;; Advance $ptr through a quoted string body to just past the $n-byte
  ;; closer held in the delimiter region, or to $end: hop between `|` bytes
  ;; with SIMD and verify the rest only at each candidate.
  (func $mlQuotedBody (param $n i32)
    (local $i i32)
    (block $done
      (loop $scan
        (global.set $ptr (call $lexFindByte (global.get $ptr) (i32.const "|")))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (if (i32.le_u (i32.add (global.get $ptr) (local.get $n)) (global.get $end))
          (then
            (local.set $i (i32.const 1))
            (block $cmpDone
              (loop $cmp
                (br_if $cmpDone (i32.ge_u (local.get $i) (local.get $n)))
                (br_if $cmpDone (i32.ne
                  (i32.load8_u (i32.add (global.get $ptr) (local.get $i)))
                  (i32.load8_u (i32.add (i32.const $mem.streamDelimiter) (local.get $i)))))
                (local.set $i (i32.add (local.get $i) (i32.const 1)))
                (br $cmp)))
            (if (i32.eq (local.get $i) (local.get $n))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (local.get $n)))
                (return)))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan))))
)
