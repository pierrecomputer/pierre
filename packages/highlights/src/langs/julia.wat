(module
  (import "../common.wat")

  (func $jlByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $hlJulia. The high byte of a
  ;; declaration value names the next name's capture: 1 a function, 2 a
  ;; type, 3 a module. `where` shares its hash features with `while` and is
  ;; matched directly.
  (keyword-table $juliaWords $mem.juliaWords $mem.juliaWords+512
    (group $Token.keyword.control ;; 1: control flow and blocks
      "if" "elseif" "else" "for" "while" "break" "continue" "return" "try"
      "catch" "finally" "do" "begin" "end" "let" "quote")
    (group $Token.keyword.declaration+256 "function" "macro") ;; 2: next name is a function
    (group $Token.keyword.declaration+512 "struct" "type")    ;; 3: next name is a type
    (group $Token.keyword.declaration+768 "module" "baremodule") ;; 4: next name is a module
    (group $Token.keyword.declaration ;; 5: other declarations
      "const" "local" "global" "mutable" "abstract" "primitive" "outer")
    (group $Token.keyword.import "using" "import" "export" "public") ;; 6
    (group $Token.keyword.operator "in" "isa")                       ;; 7
    (group $Token.boolean "true" "false")                            ;; 8
    (group $Token.constant.builtin ;; 9
      "nothing" "missing" "undef" "Inf" "NaN" "pi" "im"))

  ;; Token in the low byte and the next-name capture in the high byte, or -1
  ;; for an ordinary name.
  (func $jlWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $v i32)
    (local.set $v (keyword-table.value $juliaWords (local.get $lhs) (local.get $rhs)))
    (if (i32.ge_s (local.get $v) (i32.const 0)) (then (return (local.get $v))))
    (if (i32.and
          (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 5))
          (i32.and
            (i32.eq (i32.load (local.get $lhs)) (i32.const "wher"))
            (i32.eq (i32.load8_u offset=4 (local.get $lhs)) (i32.const "e"))))
      (then (return (enum.get $Token.keyword.operator))))
    (i32.const -1))

  ;; Whether the parenthesised list opening at $p closes on the same line
  ;; and is followed by a single `=`: the short function definition
  ;; `f(x) = x + 1`.
  (func $jlDefinedAhead (param $p i32) (result i32)
    (local $c i32) (local $depth i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $done (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (if (i32.eq (local.get $c) (i32.const "("))
          (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
        (if (i32.eq (local.get $c) (i32.const ")"))
          (then
            (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
            (if (i32.eqz (local.get $depth))
              (then
                (local.set $p (call $lexSkipSpaceAt (local.get $p)))
                (return (i32.and
                  (i32.eq (call $jlByte (local.get $p)) (i32.const "="))
                  (i32.ne (call $jlByte (i32.add (local.get $p) (i32.const 1))) (i32.const "="))))))))
        (br $l)))
    (i32.const 0))

  ;; Scan a string or command body from $ptr with the bytes since $seg still
  ;; unemitted. $q is the quote byte, $triple selects the three-quote form,
  ;; and $hl the body's token. An interpolating body ($expand) carries
  ;; `$name` variables and `$(` splices. Every form spans lines. Returns 1
  ;; past the closer, 2 past a `$(` that opens a splice - emitted as
  ;; punctuation.special, the caller lexes the expression - and 0 at $end.
  ;; $nested is nonzero inside a splice, where a nested string keeps `$(`
  ;; plain.
  (func $jlStringBody
    (param $q i32) (param $triple i32) (param $expand i32) (param $nested i32)
    (param $hl i32) (param $seg i32) (result i32)
    (local $c i32) (local $c2 i32) (local $e i32) (local $p i32) (local $stop i32) (local $dollar i32)
    (local.set $stop (global.get $ptr))
    (local.set $dollar (global.get $ptr))
    (block $done
      (loop $scan
        (if (i32.ge_u (global.get $ptr) (local.get $stop))
          (then
            (local.set $stop (call $scanFindSpecial
              (global.get $ptr) (global.get $end) (local.get $q) (i32.const 1) (i32.const 0)))
            (local.set $dollar (local.get $stop))
            (if (local.get $expand)
              (then (local.set $dollar (call $scanFindSpecial
                (global.get $ptr) (local.get $stop) (i32.const "$") (i32.const 0) (i32.const 0))))))
          (else
            (if (i32.and (local.get $expand) (i32.gt_u (global.get $ptr) (local.get $dollar)))
              (then (local.set $dollar (call $scanFindSpecial
                (global.get $ptr) (local.get $stop) (i32.const "$") (i32.const 0) (i32.const 0)))))))
        (global.set $ptr (select (local.get $dollar) (local.get $stop)
          (i32.lt_u (local.get $dollar) (local.get $stop))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $q))
          (then
            (if (i32.or (i32.eqz (local.get $triple))
                  (i32.and
                    (i32.eq (call $jlByte (i32.add (global.get $ptr) (i32.const 1))) (local.get $q))
                    (i32.eq (call $jlByte (i32.add (global.get $ptr) (i32.const 2))) (local.get $q))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 3) (i32.const 1) (local.get $triple))))
                (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
                (return (i32.const 1))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $scan)))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
            (local.set $e (call $lexEscapeEnd (global.get $ptr)))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        ;; `$`: a splice or a name
        (local.set $c2 (call $jlByte (i32.add (global.get $ptr) (i32.const 1))))
        (if (i32.and (i32.eq (local.get $c2) (i32.const "(")) (i32.eqz (local.get $nested)))
          (then
            (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.special)
              (i32.sub (global.get $ptr) (i32.const 2)) (global.get $ptr))
            (return (i32.const 2))))
        (if (i32.and (call $lexIsIdentStart (local.get $c2)) (i32.ne (local.get $c2) (i32.const "$")))
          (then
            (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
            (local.set $p (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (call $emitTok (enum.get $Token.variable) (local.get $p) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
    (i32.const 0))

  (func $jlIsOp (param $c i32) (result i32)
    (byteset.get "!$%&*+-/:<=>?\5c^|~" (local.get $c)))

  ;; SCREAMING_CASE with an underscore: `MAX_ITER` is a constant, while
  ;; `IO` and `PI` are types by Julia convention
  (func $jlIsConstName (param $lhs i32) (param $rhs i32) (result i32)
    (local $p i32)
    (if (i32.eqz (call $lexIsConstCase (local.get $lhs) (local.get $rhs)))
      (then (return (i32.const 0))))
    (local.set $p (local.get $lhs))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $rhs)))
        (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "_"))
          (then (return (i32.const 1))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (i32.const 0))

  ;; $strKind is 1 inside a `"` body, 2 inside `"""`, 3 and 4 for the raw
  ;; forms behind a prefix such as `r"..."`, and 5 inside a backtick
  ;; command, with $strHl the body's token and $seg the start of the bytes
  ;; not yet emitted; $interp counts parentheses inside a `$(` splice and
  ;; $interpKind remembers which body to return to. $expect is the pending
  ;; capture after a declaration keyword: 1 a function, 2 a type, 3 a
  ;; module. $member is 1 after `.`, $importCtx 1 on a using/import line,
  ;; $stmtHead 1 before the first token of a statement - where `f(x) = ...`
  ;; defines `f` - and $afterValue 1 after a value, where `'` is the adjoint
  ;; operator rather than a character literal. All are checkpointed.
  (func $hlJulia
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32) (local $e i32)
    (local $kind i32) (local $hl i32) (local $status i32)
    (local $strKind i32) (local $strHl i32) (local $seg i32) (local $interp i32) (local $interpKind i32)
    (local $expect i32) (local $member i32) (local $importCtx i32) (local $stmtHead i32) (local $afterValue i32)
    (local.set $stmtHead (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; an open string body; $seg is zero across a chunk boundary, where
        ;; the body resumes at the chunk start
        (if (local.get $strKind)
          (then
            (if (i32.ge_u (global.get $ptr) (global.get $end))
              (then
                (local.set $seg (i32.const 0))
                (br $done)))
            (if (i32.eqz (local.get $seg))
              (then (local.set $seg (global.get $ptr))))
            (local.set $status (call $jlStringBody
              (select (i32.const 96) (i32.const 34) (i32.eq (local.get $strKind) (i32.const 5)))
              (i32.eqz (i32.and (local.get $strKind) (i32.const 1)))
              (i32.or (i32.le_u (local.get $strKind) (i32.const 2)) (i32.eq (local.get $strKind) (i32.const 5)))
              (local.get $interp)
              (local.get $strHl)
              (local.get $seg)))
            (local.set $seg (global.get $ptr))
            (if (i32.eq (local.get $status) (i32.const 2))
              (then
                (local.set $interpKind (local.get $strKind))
                (local.set $interp (i32.const 1))
                (local.set $strKind (i32.const 0))
                (local.set $seg (i32.const 0))
                (local.set $afterValue (i32.const 0)))
              (else
                (if (i32.eq (local.get $status) (i32.const 1))
                  (then
                    (local.set $strKind (i32.const 0))
                    (local.set $seg (i32.const 0))
                    (local.set $afterValue (i32.const 1))))))
            (br $next)))

        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        ;; a line break ends an import line and starts a statement
        (if (i32.lt_u
              (call $scanFindSpecial (local.get $gap) (global.get $ptr)
                (i32.const 10) (i32.const 0) (i32.const 1))
              (global.get $ptr))
          (then
            (local.set $importCtx (i32.const 0))
            (local.set $stmtHead (i32.const 1))
            (local.set $afterValue (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $jlByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $jlByte (i32.add (global.get $ptr) (i32.const 2))))

        ;; `#= ... =#` nests
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (if (i32.eq (local.get $c2) (i32.const "="))
              (then (call $lexNestedBlockComment (i32.const "#=") (i32.const "=#") (enum.get $Token.comment)))
              (else (call $lexLineComment (i32.const 1) (enum.get $Token.comment))))
            (br $next)))

        ;; string and command openers are emitted at once; the body is
        ;; scanned at the top of the loop, where it can also resume after a
        ;; chunk boundary
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 96)))
          (then
            (local.set $strKind (select (i32.const 5) (i32.const 1) (i32.eq (local.get $c) (i32.const 96))))
            (local.set $strHl (select (enum.get $Token.string.special) (enum.get $Token.string)
              (i32.eq (local.get $c) (i32.const 96))))
            (if (i32.and
                  (i32.eq (local.get $c) (i32.const 34))
                  (i32.and (i32.eq (local.get $c2) (i32.const 34)) (i32.eq (local.get $c3) (i32.const 34))))
              (then
                (local.set $strKind (i32.const 2))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (local.get $strHl) (local.get $lhs) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        ;; `'`: the adjoint of a value, else a character literal
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (if (i32.and (local.get $afterValue) (i32.eq (local.get $gap) (local.get $lhs)))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (if (i32.eq (local.get $c2) (i32.const 92))
              (then (local.set $e (call $lexEscapeEnd (i32.add (global.get $ptr) (i32.const 1)))))
              (else (local.set $e (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 2)) (global.get $end)))))
            ;; `'é'` carries hex digits after the escape
            (block $hexDone
              (loop $hex
                (br_if $hexDone (i32.ge_u (local.get $e) (i32.add (global.get $ptr) (i32.const 12))))
                (br_if $hexDone (i32.eqz (call $lexIsHex (call $jlByte (local.get $e)))))
                (local.set $e (i32.add (local.get $e) (i32.const 1)))
                (br $hex)))
            (if (i32.and
                  (i32.gt_u (local.get $c2) (i32.const 32))
                  (i32.eq (call $jlByte (local.get $e)) (i32.const 39)))
              (then
                (global.set $ptr (i32.add (local.get $e) (i32.const 1)))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (local.set $afterValue (i32.const 1)))
              (else
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (local.set $afterValue (i32.const 0))))
            (local.set $member (i32.const 0))
            (br $next)))
        ;; `@macro` and `@.`
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "@"))
              (i32.or (call $lexIsIdentStart (local.get $c2)) (i32.eq (local.get $c2) (i32.const "."))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $scanIdentRun (i32.const "!"))
            (call $emitTok (enum.get $Token.function) (local.get $lhs) (global.get $ptr))
            (local.set $afterValue (i32.const 0))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $scanIdentRun (i32.const "_"))
            ;; `push!` and other mutating names end in `!`
            (if (i32.and
                  (i32.eq (call $jlByte (global.get $ptr)) (i32.const "!"))
                  (i32.ne (call $jlByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "=")))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            ;; `r"..."`, `raw"..."`, `b"..."`: a prefix, then a raw string body
            (if (i32.eq (call $jlByte (local.get $rhs)) (i32.const 34))
              (then
                (call $emitTok (enum.get $Token.function) (local.get $lhs) (local.get $rhs))
                (local.set $strHl (select (enum.get $Token.string.regex) (enum.get $Token.string)
                  (i32.and
                    (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 1))
                    (i32.eq (local.get $c) (i32.const "r")))))
                (local.set $strKind (i32.const 3))
                (if (i32.and
                      (i32.eq (call $jlByte (i32.add (local.get $rhs) (i32.const 1))) (i32.const 34))
                      (i32.eq (call $jlByte (i32.add (local.get $rhs) (i32.const 2))) (i32.const 34)))
                  (then
                    (local.set $strKind (i32.const 4))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (local.get $strHl) (local.get $rhs) (global.get $ptr))
                (local.set $seg (global.get $ptr))
                (local.set $member (i32.const 0))
                (br $next)))
            (local.set $kind (select (i32.const -1)
              (call $jlWordHl (local.get $lhs) (local.get $rhs))
              (i32.or (local.get $member) (local.get $importCtx))))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (if (i32.shr_u (local.get $kind) (i32.const 8))
                  (then (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8)))))
                (if (i32.eq (local.get $hl) (enum.get $Token.keyword.import))
                  (then (local.set $importCtx (i32.const 1))))
                ;; `end` closes an index or a block and stands as a value
                (local.set $afterValue (i32.or
                  (i32.or
                    (i32.eq (local.get $hl) (enum.get $Token.boolean))
                    (i32.eq (local.get $hl) (enum.get $Token.constant.builtin)))
                  (i32.and
                    (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 3))
                    (i32.eq (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff)) (i32.const "end"))))))
              (else
                (local.set $afterValue (i32.const 1))
                (if (local.get $importCtx)
                  (then (local.set $hl (enum.get $Token.namespace)))
                  (else
                    (if (local.get $expect)
                      (then
                        ;; `function Base.show(` qualifies the name; the
                        ;; module part keeps the capture open
                        (if (i32.eq (call $jlByte (local.get $rhs)) (i32.const "."))
                          (then (local.set $hl (enum.get $Token.namespace)))
                          (else
                            (local.set $hl (enum.get $Token.function.definition))
                            (if (i32.eq (local.get $expect) (i32.const 2))
                              (then (local.set $hl (enum.get $Token.type))))
                            (if (i32.eq (local.get $expect) (i32.const 3))
                              (then (local.set $hl (enum.get $Token.namespace))))
                            (local.set $expect (i32.const 0)))))
                      (else
                        (if (local.get $member)
                          (then (local.set $hl (select (enum.get $Token.function.method) (enum.get $Token.property)
                            (i32.eq (call $jlByte (local.get $p)) (i32.const "(")))))
                          (else
                            (if (call $jlIsConstName (local.get $lhs) (local.get $rhs))
                              (then (local.set $hl (enum.get $Token.constant)))
                              (else
                                (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                                  (then (local.set $hl (enum.get $Token.type)))
                                  (else
                                    (if (i32.eq (call $jlByte (local.get $p)) (i32.const "("))
                                      (then
                                        ;; `f(x) = ...` at a statement head defines f
                                        (local.set $hl (select
                                          (enum.get $Token.function.definition) (enum.get $Token.function)
                                          (i32.and (local.get $stmtHead) (call $jlDefinedAhead (local.get $p))))))
                                      (else (local.set $hl (enum.get $Token.variable))))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (local.set $stmtHead (i32.const 0))
            (br $next)))

        (if (i32.or (call $lexIsDigit (local.get $c))
                    (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $afterValue (i32.const 1))
            (local.set $stmtHead (i32.const 0))
            (br $next)))

        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (local.get $interp)
              (then
                (if (i32.eq (local.get $c) (i32.const "("))
                  (then (local.set $interp (i32.add (local.get $interp) (i32.const 1)))))
                (if (i32.eq (local.get $c) (i32.const ")"))
                  (then
                    (local.set $interp (i32.sub (local.get $interp) (i32.const 1)))
                    (if (i32.eqz (local.get $interp))
                      (then
                        ;; the paren matching `$(` returns to the string body
                        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                        (local.set $strKind (local.get $interpKind))
                        (local.set $interpKind (i32.const 0))
                        (local.set $seg (global.get $ptr))
                        (local.set $member (i32.const 0))
                        (br $next)))))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $afterValue (byteset.get ")]}" (local.get $c)))
            (local.set $member (i32.const 0))
            (local.set $stmtHead (i32.const 0))
            (if (i32.eq (local.get $c) (i32.const "("))
              (then (local.set $expect (i32.const 0))))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $afterValue (i32.const 0))
            (if (i32.eq (local.get $c) (i32.const ";"))
              (then
                (local.set $stmtHead (i32.const 1))
                (local.set $expect (i32.const 0))
                (local.set $importCtx (i32.const 0))))
            (br $next)))
        ;; `.name` selects a field; `.+` and `...` are operators
        (if (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.eqz (call $jlIsOp (local.get $c2))))
          (then
            (if (i32.eq (local.get $c2) (i32.const "."))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (if (i32.eq (local.get $c3) (i32.const "."))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (local.set $afterValue (i32.const 0)))
              (else
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
                (local.set $member (i32.const 1))
                (local.set $afterValue (i32.const 0))))
            (local.set $stmtHead (i32.const 0))
            (br $next)))
        ;; `:sym` quotes a symbol; a `:` after a value is a range
        (if (i32.and
              (i32.eq (local.get $c) (i32.const ":"))
              (i32.and
                (i32.eqz (local.get $afterValue))
                (i32.and (call $lexIsIdentStart (local.get $c2)) (i32.ne (local.get $c2) (i32.const "$")))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanIdentRun (i32.const "!"))
            (call $emitTok (enum.get $Token.string.special.symbol) (local.get $lhs) (global.get $ptr))
            (local.set $afterValue (i32.const 1))
            (local.set $stmtHead (i32.const 0))
            (br $next)))

        (if (i32.or (call $jlIsOp (local.get $c)) (i32.eq (local.get $c) (i32.const ".")))
          (then
            (block $opDone
              (loop $op
                (br_if $opDone (i32.eqz (i32.or
                  (call $jlIsOp (call $jlByte (global.get $ptr)))
                  (i32.eq (call $jlByte (global.get $ptr)) (i32.const ".")))))
                ;; a comment opener ends the run
                (br_if $opDone (i32.eq (call $jlByte (global.get $ptr)) (i32.const "#")))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $afterValue (i32.const 0))
            (local.set $stmtHead (i32.const 0))
            (br $next)))

        (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (local.set $stmtHead (i32.const 0))
        (br $next))))
)
