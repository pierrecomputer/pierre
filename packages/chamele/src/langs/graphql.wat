(module
  (import "../common.wat")

  (func $gqlByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $hlGraphql. Groups 1-3 are
  ;; contextual: `type`, `on`, or `input` is also an ordinary field name,
  ;; so they count as keywords only when a name, brace, directive, paren,
  ;; or `&` follows on the same line.
  (keyword-table $graphqlWords $mem.graphqlWords $mem.graphqlWords+384 16 32
    (group ;; 1: definitions, next name is a type
      "type" "interface" "union" "enum" "input" "scalar" "on" "implements")
    (group ;; 2: operations, next name is an operation or fragment
      "query" "mutation" "subscription" "fragment")
    (group "extend" "schema" "directive" "repeatable") ;; 3: other keywords
    (group "true" "false")                             ;; 4: booleans
    (group "null")                                     ;; 5: built-in constant
    (group "Int" "Float" "String" "Boolean" "ID"))     ;; 6: built-in scalars

  ;; Scan a `"""` block string whose opener sits at $ptr; `\"""` does not
  ;; close it. Streaming keeps looking for the closer in the next chunk.
  (func $gqlBlockString
    (local $lhs i32)
    (local $p i32)
    (local $closed i32)
    (local.set $lhs (global.get $ptr))
    (local.set $p (i32.add (global.get $ptr) (i32.const 3)))
    (block $done
      (loop $scan
        (local.set $p (call $lexFindByte (local.get $p) (i32.const 34)))
        (if (i32.ge_u (local.get $p) (global.get $end))
          (then
            (global.set $ptr (global.get $end))
            (br $done)))
        (if (i32.and
              (i32.eq (call $gqlByte (i32.add (local.get $p) (i32.const 1))) (i32.const 34))
              (i32.and
                (i32.eq (call $gqlByte (i32.add (local.get $p) (i32.const 2))) (i32.const 34))
                (i32.ne (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const 92))))
          (then
            ;; both trailing quotes read below $end, so this cannot overshoot
            (global.set $ptr (i32.add (local.get $p) (i32.const 3)))
            (local.set $closed (i32.const 1))
            (br $done)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
    (if (i32.eqz (local.get $closed))
      (then (call $streamSetFixed32 (i32.const 0x222222) (i32.const 3) (enum.get $Token.string)))))

  ;; $expect names the capture of the next name: 1 type, 2 operation or
  ;; fragment definition, 3 fragment spread. $paren counts open parens, where
  ;; `name:` is an argument rather than a field. Both are checkpointed.
  (func $hlGraphql
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $g i32) (local $hl i32) (local $expect i32) (local $paren i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $gqlByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $gqlByte (i32.add (global.get $ptr) (i32.const 2))))

        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (if (i32.and (i32.eq (local.get $c2) (i32.const 34)) (i32.eq (local.get $c3) (i32.const 34)))
              (then (call $gqlBlockString))
              (else (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "$")) (call $lexIsIdentStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "@")) (call $lexIsIdentStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; `...Fragment` and `... on Type`
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "."))
              (i32.and (i32.eq (local.get $c2) (i32.const ".")) (i32.eq (local.get $c3) (i32.const "."))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (local.set $expect (i32.const 3))
            (br $next)))

        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $g (keyword-table.get $graphqlWords (local.get $lhs) (local.get $rhs)))
            ;; the contextual groups need a name, brace, directive, paren,
            ;; or `&` after them on the same line
            (if (i32.and
                  (i32.and (i32.ge_u (local.get $g) (i32.const 1)) (i32.le_u (local.get $g) (i32.const 3)))
                  (i32.eqz (i32.or
                    (i32.or
                      (call $lexIsIdentStart (call $gqlByte (local.get $p)))
                      (i32.eq (call $gqlByte (local.get $p)) (i32.const "{")))
                    (i32.or
                      (i32.or
                        (i32.eq (call $gqlByte (local.get $p)) (i32.const "@"))
                        (i32.eq (call $gqlByte (local.get $p)) (i32.const "(")))
                      (i32.eq (call $gqlByte (local.get $p)) (i32.const "&"))))))
              (then (local.set $g (i32.const 0))))
            (if (local.get $g)
              (then
                (local.set $hl (enum.get $Token.keyword))
                (if (i32.eq (local.get $g) (i32.const 4)) (then (local.set $hl (enum.get $Token.boolean))))
                (if (i32.eq (local.get $g) (i32.const 5)) (then (local.set $hl (enum.get $Token.constant.builtin))))
                (if (i32.eq (local.get $g) (i32.const 6)) (then (local.set $hl (enum.get $Token.type.builtin))))
                (local.set $expect (i32.const 0))
                (if (i32.eq (local.get $g) (i32.const 1)) (then (local.set $expect (i32.const 1))))
                (if (i32.eq (local.get $g) (i32.const 2)) (then (local.set $expect (i32.const 2)))))
              (else
                (if (local.get $expect)
                  (then
                    ;; `on FIELD_DEFINITION` names a directive location
                    (local.set $hl (select (enum.get $Token.constant) (enum.get $Token.type)
                      (call $lexIsConstCase (local.get $lhs) (local.get $rhs))))
                    (if (i32.eq (local.get $expect) (i32.const 2))
                      (then (local.set $hl (enum.get $Token.function.definition))))
                    (if (i32.eq (local.get $expect) (i32.const 3))
                      (then (local.set $hl (enum.get $Token.function))))
                    (local.set $expect (i32.const 0)))
                  (else
                    (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                      (then
                        (local.set $hl (select (enum.get $Token.constant) (enum.get $Token.type)
                          (call $lexIsConstCase (local.get $lhs) (local.get $rhs)))))
                      (else
                        ;; `name:` is an argument inside parens and a field
                        ;; elsewhere; `name(` a field with arguments
                        (local.set $hl (enum.get $Token.property))
                        (if (i32.eq (call $gqlByte (local.get $p)) (i32.const ":"))
                          (then
                            (if (local.get $paren)
                              (then (local.set $hl (enum.get $Token.variable.parameter)))))
                          (else
                            (if (i32.eq (call $gqlByte (local.get $p)) (i32.const "("))
                              (then (local.set $hl (enum.get $Token.function))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        (if (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and (i32.eq (local.get $c) (i32.const "-")) (call $lexIsDigit (local.get $c2))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const ")")))
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "]")))
                (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (if (i32.eq (local.get $c) (i32.const "("))
              (then (local.set $paren (i32.add (local.get $paren) (i32.const 1)))))
            (if (i32.and (i32.eq (local.get $c) (i32.const ")")) (i32.gt_u (local.get $paren) (i32.const 0)))
              (then (local.set $paren (i32.sub (local.get $paren) (i32.const 1)))))
            (local.set $expect (i32.const 0))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ":")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "!")) (i32.eq (local.get $c) (i32.const "=")))
              (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const "&"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
