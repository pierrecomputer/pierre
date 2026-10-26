(module
  (import "../common.wat")
  (import "./tsx.wat")

  ;; Groups 1-7 double as $decl values. Value types (group 11) count only where
  ;; a type is expected, so `color: "red"` stays a binding.
  (keyword-table $qmlWords $mem.qmlWords $mem.prologWords
    (group "property")                      ;; 1: a type and a name follow
    (group "readonly" "required" "default") ;; 2: modifiers, a name may follow
    (group "signal")                        ;; 3: next name is a signal
    (group "function")                      ;; 4: next name is a function
    (group "component")                     ;; 5: next name is a component type
    (group "enum")                          ;; 6: next name is an enum type
    (group "import")                        ;; 7: an import line
    (group "pragma" "on")                   ;; 8: other keywords
    (group "alias")                         ;; 9: property alias
    (group "as")                            ;; 10: import qualifier
    (group ;; 11: value types
      "int" "bool" "real" "double" "string" "url" "var" "list" "color" "date" "point" "rect"
      "size" "font" "variant"))

  ;; The `;` that ends a value on this line outside brackets, quotes, and
  ;; comments, or 0.
  (func $qmlValueEnd (param $p i32) (result i32)
    (local $c i32)
    (local $b i32)
    (local $depth i32)
    (block $none
      (loop $scan
        (br_if $none (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br_if $scan (i32.eqz (byteset.get "\n\r\"'/;`()[]{}" (local.get $c))))
        (br_if $none (byteset.get "\n\r" (local.get $c)))
        (if (byteset.get "([{" (local.get $c))
          (then
            (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
            (br $scan)))
        (if (byteset.get ")]}" (local.get $c))
          (then
            (br_if $none (i32.eqz (local.get $depth)))
            (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
            (br $scan)))
        (if (i32.eq (local.get $c) (i32.const ";"))
          (then
            (br_if $scan (local.get $depth))
            (return (i32.sub (local.get $p) (i32.const 1)))))
        (if (i32.eq (local.get $c) (i32.const "/"))
          (then
            (local.set $c (call $templateByte (local.get $p)))
            (br_if $none
              (i32.or (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c) (i32.const "*"))))
            (br $scan)))
        (loop $quote
          (local.set $p
            (call $scanFindSpecial
              (local.get $p)
              (global.get $end)
              (local.get $c)
              (i32.const 1)
              (i32.const 1)))
          (local.set $b (call $templateByte (local.get $p)))
          (br_if $none (i32.or (i32.eqz (local.get $b)) (byteset.get "\n\r" (local.get $b))))
          (local.set $p (i32.add (local.get $p) (i32.const 1)))
          (br_if $scan (i32.eq (local.get $b) (local.get $c)))
          (local.set $b (call $templateByte (local.get $p)))
          (br_if $none (i32.or (i32.eqz (local.get $b)) (byteset.get "\n\r" (local.get $b))))
          (local.set $p (i32.add (local.get $p) (i32.const 1)))
          (br $quote))))
    (i32.const 0))

  ;; Returns 2 when the value goes on to the next line, else 0. Each range ends
  ;; where the JS lexer stops by itself, so line-fed runs match whole ones.
  ;; WARNING: an open value lives in $hlQml's checkpointed $js, not a stream
  ;; region: closing a region clears every lexer's saved locals.
  (func $qmlJs (param $to i32) (param $reset i32) (result i32)
    (local $save i32)
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (global.set $ecmaFeatures (i32.const 0))
    (global.set $tsxStreaming (i32.const 1))
    (global.set $tsxStreamExpressionClose (i32.const 1))
    (global.set $tsxStreamExpressionClosed (i32.const 0))
    (if (local.get $reset)
      (then (global.set $tsxStreamExpressionDepth (i32.const 0))))
    (call $hlEcmaImpl (local.get $reset))
    (global.set $end (local.get $save))
    (select
      (i32.const 0)
      (i32.shl
        (i32.ne
          (i32.or
            (i32.or (global.get $brkSp) (global.get $tsxStreamMode))
            (global.get $jsTemplateLexSp))
          (i32.const 0))
        (i32.const 1))
      (global.get $tsxStreamExpressionClosed)))

  ;; $js: 1 when a value starts at $ptr, 2 while one goes on. $decl: what comes
  ;; next, 1-7 as the keyword groups, 8 a function body or result type, 9 a
  ;; parameter type, 10 an enum body, 11-12 a signal or function parameter list.
  ;; $bind: 1 after a binding name.
  (func $hlQml
    (local $c i32)
    (local $c2 i32)
    (local $d i32)
    (local $g i32)
    (local $gap i32)
    (local $hl i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $n i32)
    (local $p i32)
    (local $upper i32)
    (local $atMember i32)
    (local $js i32)
    (local $decl i32)
    (local $params i32)
    (local $enum i32)
    (local $member i32)
    (local $bind i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (if (local.get $js)
          (then
            (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $p (i32.const 0))
            (if (i32.eq (local.get $js) (i32.const 1))
              (then (local.set $p (call $qmlValueEnd (global.get $ptr)))))
            (if (i32.eqz (local.get $p))
              (then
                (local.set $lhs (global.get $ptr))
                (call $scanToLineEnd)
                (local.set $p (global.get $ptr))
                (global.set $ptr (local.get $lhs))
                (if (i32.eq (call $templateByte (local.get $p)) (i32.const 13))
                  (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
                (if (i32.eq (call $templateByte (local.get $p)) (i32.const 10))
                  (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))))
            (local.set $js (call $qmlJs (local.get $p) (i32.eq (local.get $js) (i32.const 1))))
            (br $next)))

        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (i32.eq (local.get $decl) (i32.const 7))
          (then
            (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
              (then (local.set $decl (i32.const 0))))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment
              (i32.const 2)
              (select
                (enum.get $Token.comment.doc)
                (enum.get $Token.comment)
                (i32.and
                  (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "*"))
                  (i32.ne (call $templateByte (i32.add (local.get $lhs) (i32.const 3))) (i32.const "/")))))
            (br $next)))
        (local.set $atMember (local.get $member))
        (local.set $member (i32.const 0))
        (local.set $d (local.get $decl))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (local.set $n (call $templateByte (call $lexSkipSpaceAt (local.get $rhs))))
            (local.set $g (i32.const 0))
            (if (i32.eqz (local.get $atMember))
              (then (local.set $g (keyword-table.get $qmlWords (local.get $lhs) (local.get $rhs)))))
            (local.set $upper (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))
            (local.set $decl (i32.const 0))
            (block $classified
              (if (i32.eq (local.get $d) (i32.const 7))
                (then
                  (local.set $hl
                    (select
                      (enum.get $Token.keyword.import)
                      (enum.get $Token.namespace)
                      (i32.eq (local.get $g) (i32.const 10))))
                  (local.set $decl (i32.const 7))
                  (br $classified)))
              (if
                (i32.or
                  (i32.or
                    (i32.eq (local.get $d) (i32.const 1))
                    (i32.le_u (i32.sub (local.get $d) (i32.const 8)) (i32.const 1)))
                  (i32.and
                    (i32.ne (local.get $params) (i32.const 0))
                    (call $lexIsIdentStart (local.get $n))))
                (then
                  (local.set $hl
                    (select
                      (enum.get $Token.type.builtin)
                      (select
                        (enum.get $Token.keyword.declaration)
                        (enum.get $Token.type)
                        (i32.eq (local.get $g) (i32.const 9)))
                      (i32.eq (local.get $g) (i32.const 11))))
                  (local.set $decl
                    (select
                      (local.get $d)
                      (select
                        (i32.const 2)
                        (select (i32.const 8) (i32.const 0) (i32.eq (local.get $d) (i32.const 8)))
                        (i32.eq (local.get $d) (i32.const 1)))
                      (i32.or
                        (i32.eq (local.get $n) (i32.const "."))
                        (i32.eq (local.get $n) (i32.const "<")))))
                  (br $classified)))
              (if (local.get $params)
                (then
                  (local.set $hl (enum.get $Token.variable.parameter))
                  (br $classified)))
              (if (i32.and (i32.eq (local.get $d) (i32.const 2)) (i32.ne (local.get $g) (i32.const 1)))
                (then
                  (local.set $hl (enum.get $Token.property))
                  (local.set $bind (i32.eq (local.get $n) (i32.const ":")))
                  (br $classified)))
              (if (i32.le_u (i32.sub (local.get $d) (i32.const 3)) (i32.const 1))
                (then
                  (local.set $hl (enum.get $Token.function.definition))
                  (local.set $decl (i32.add (local.get $d) (i32.const 8)))
                  (br $classified)))
              (if (i32.le_u (i32.sub (local.get $d) (i32.const 5)) (i32.const 1))
                (then
                  (local.set $hl (enum.get $Token.type))
                  (local.set $decl
                    (select (i32.const 10) (i32.const 0) (i32.eq (local.get $d) (i32.const 6))))
                  (local.set $bind (i32.eq (local.get $n) (i32.const ":")))
                  (br $classified)))
              (if (local.get $enum)
                (then
                  (local.set $hl (enum.get $Token.constant))
                  (br $classified)))
              (if (i32.eq (local.get $n) (i32.const ":"))
                (then
                  (local.set $bind (i32.const 1))
                  (local.set $hl (enum.get $Token.property))
                  (if
                    (i32.and
                      (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "on"))
                      (i32.le_u
                        (i32.sub (i32.load8_u offset=2 (local.get $lhs)) (i32.const "A"))
                        (i32.const 25)))
                    (then (local.set $hl (enum.get $Token.function))))
                  (if
                    (i32.and
                      (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 2))
                      (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "id")))
                    (then (local.set $hl (enum.get $Token.keyword))))
                  (br $classified)))
              (if (i32.le_u (i32.sub (local.get $g) (i32.const 1)) (i32.const 7))
                (then
                  (local.set $hl
                    (select
                      (enum.get $Token.keyword)
                      (select
                        (enum.get $Token.keyword.import)
                        (enum.get $Token.keyword.declaration)
                        (i32.eq (local.get $g) (i32.const 7)))
                      (i32.eq (local.get $g) (i32.const 8))))
                  (local.set $decl
                    (select (i32.const 0) (local.get $g) (i32.eq (local.get $g) (i32.const 8))))
                  (br $classified)))
              (if (i32.eq (local.get $n) (i32.const "("))
                (then
                  (local.set $hl
                    (select
                      (enum.get $Token.function.method)
                      (enum.get $Token.function)
                      (local.get $atMember)))
                  (br $classified)))
              ;; `anchors {` and `anchors.` group properties; other capitalized names are types
              (local.set $hl
                (select
                  (enum.get $Token.type)
                  (select
                    (enum.get $Token.property)
                    (enum.get $Token.variable)
                    (i32.or
                      (local.get $atMember)
                      (i32.or (i32.eq (local.get $n) (i32.const "{")) (i32.eq (local.get $n) (i32.const ".")))))
                  (local.get $upper))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        (if
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
            (i32.eq (local.get $c) (i32.const "`")))
          (then
            (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (br $next)))
        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (local.set $decl (i32.const 0))
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (if (local.get $bind)
              (then
                (local.set $bind (i32.const 0))
                (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                (local.set $c (call $templateByte (local.get $p)))
                (local.set $js
                  (i32.eqz
                    (i32.or
                      (i32.or (i32.eqz (local.get $c)) (i32.eq (local.get $c) (i32.const "[")))
                      (byteset.get "\n\r" (local.get $c)))))
                (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                  (then
                    (global.set $ptr (local.get $p))
                    (call $scanIdentRun (i32.const "."))
                    (local.set $c (call $templateByte (call $lexSkipSpaceAt (global.get $ptr))))
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                    (if (i32.eq (local.get $c) (i32.const "{"))
                      (then (local.set $js (i32.const 0))))))
                (br $next)))
            (if (local.get $params)
              (then (local.set $decl (i32.const 9))))
            (if (i32.eq (local.get $d) (i32.const 8))
              (then (local.set $decl (i32.const 8))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 1))
            (local.set $decl (local.get $d))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "{"))
          (then
            (if (i32.eq (local.get $d) (i32.const 8))
              (then
                (global.set $ptr (local.get $lhs))
                (local.set $js (i32.const 1))
                (br $next)))
            (local.set $enum (i32.eq (local.get $d) (i32.const 10)))
            (local.set $params (i32.const 0))))
        (if (i32.eq (local.get $c) (i32.const "}"))
          (then
            (local.set $enum (i32.const 0))
            (local.set $params (i32.const 0))))
        (if (i32.eq (local.get $c) (i32.const "("))
          (then
            (if (i32.ge_u (local.get $d) (i32.const 11))
              (then (local.set $params (i32.sub (local.get $d) (i32.const 10)))))))
        (if (i32.eq (local.get $c) (i32.const ")"))
          (then
            (if (i32.eq (local.get $params) (i32.const 2))
              (then (local.set $decl (i32.const 8))))
            (local.set $params (i32.const 0))))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; operators keep a pending type going through `list<Item>`
        (if (byteset.get "!%&*+-/<=>?^|~" (local.get $c))
          (then
            (block $opDone
              (loop $op
                (local.set $c (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eqz (byteset.get "!%&*+-/<=>?^|~" (local.get $c))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $decl (local.get $d))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
