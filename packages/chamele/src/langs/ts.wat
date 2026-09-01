(module
  ;; TypeScript-aware semantic classification shared by TS and TSX.
  ;; $Token bucket for a proper keyword token, mirroring Zed's typescript query:
  ;; control flow and declaration introducers get their own buckets, literal
  ;; keywords their literal kinds, everything else - new/typeof/in/void/... -
  ;; stays plain `keyword`
  (func $kwHl (param $t i32) (result i32)
    (if (bitset.get $LexBits.kwControl (local.get $t))
      (then (return (enum.get $Token.keyword.control))))
    (if (bitset.get $LexBits.kwDecl (local.get $t))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.or (i32.eq (local.get $t) (enum.get $Lex.keyword_import))
                (i32.eq (local.get $t) (enum.get $Lex.keyword_export)))
      (then (return (enum.get $Token.keyword.import))))
    (if (i32.or (i32.eq (local.get $t) (enum.get $Lex.keyword_true))
                (i32.eq (local.get $t) (enum.get $Lex.keyword_false)))
      (then (return (enum.get $Token.boolean))))
    (if (i32.eq (local.get $t) (enum.get $Lex.keyword_null))
      (then (return (enum.get $Token.constant.builtin))))
    (if (i32.or (i32.eq (local.get $t) (enum.get $Lex.keyword_this))
                (i32.eq (local.get $t) (enum.get $Lex.keyword_super)))
      (then (return (enum.get $Token.variable.special))))
    (enum.get $Token.keyword))

  ;; identifier-like next token: an identifier, keyword, or contextual word -
  ;; the cheap "does this ctxword read as a keyword here" test
  (func $isIdentish (param $t i32) (result i32)
    (i32.or
      (i32.eq (local.get $t) (enum.get $Lex.identifier))
      (i32.and (i32.ge_u (local.get $t) (enum.get $Lex.keyword_break))
               (i32.le_u (local.get $t) (enum.get $Lex.ctxword_type)))))

  ;; undefined / NaN / Infinity spelled out
  (func $isBuiltinConst (param $lhs i32) (param $rhs i32) (result i32)
    (local $len i32)
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.eq (local.get $len) (i32.const 9))
      (then
        (return (i32.and
          (i64.eq (i64.load (local.get $lhs)) (i64.const "undefine"))
          (i32.eq (i32.load8_u offset=8 (local.get $lhs)) (i32.const "d"))))))
    (if (i32.eq (local.get $len) (i32.const 3))
      (then
        (return (i32.eq (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff))
                        (i32.const "NaN")))))
    (if (i32.eq (local.get $len) (i32.const 8))
      (then
        (return (i64.eq (i64.load (local.get $lhs)) (i64.const "Infinity")))))
    (i32.const 0))

  ;; lowercase predefined types that Zed captures as type.builtin
  (func $isPredefinedType (param $lhs i32) (param $rhs i32) (result i32)
    (local $len i32)
    (local $w i64)
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))
    (local.set $w (i64.load (local.get $lhs)))
    (if (i32.eq (local.get $len) (i32.const 3))
      (then (return (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "any")))))
    (if (i32.eq (local.get $len) (i32.const 5))
      (then (return (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "never")))))
    (if (i32.eq (local.get $len) (i32.const 6))
      (then
        (local.set $w (i64.and (local.get $w) (i64.const 0xffffffffffff)))
        (return (i32.or
          (i32.or (i64.eq (local.get $w) (i64.const "number"))
                  (i64.eq (local.get $w) (i64.const "string")))
          (i32.or (i64.eq (local.get $w) (i64.const "symbol"))
                  (i64.eq (local.get $w) (i64.const "object")))))))
    (if (i32.eq (local.get $len) (i32.const 7))
      (then
        (local.set $w (i64.and (local.get $w) (i64.const 0xffffffffffffff)))
        (return (i32.or (i64.eq (local.get $w) (i64.const "boolean"))
                        (i64.eq (local.get $w) (i64.const "unknown"))))))
    (i32.const 0))

  ;; The ecma driver for the shared parameter-list machine in sig.wat: a
  ;; paren following a `function`/`catch`/`constructor`/accessor head, or one
  ;; whose first identifier carries a TS `name:` annotation - a call cannot -
  ;; is a parameter list, and identifiers at its top level (or one level into
  ;; a destructuring pattern, matching Zed's one-level captures) classify as
  ;; variable.parameter.

  ;; the exact word `constructor` - a class constructor head
  (func $isConstructorWord (param $lhs i32) (param $rhs i32) (result i32)
    (if (i32.ne (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 11))
      (then (return (i32.const 0))))
    (i32.and
      (i64.eq (i64.load (local.get $lhs)) (i64.const "construc"))
      (i32.eq (i32.load offset=7 (local.get $lhs)) (i32.const "ctor"))))

  ;; after `( ident )`: whitespace-skipping byte lookahead for the `=>` that
  ;; makes the ident a sole parenthesized arrow parameter. The pipeline
  ;; already scanned the `)`, so the tokenizer global $rhs is its end.
  (func $sigArrowAhead (result i32)
    (local $p i32)
    (local $c i32)
    (local.set $p (global.get $rhs))
    (block $stop
      (loop $skip
        (local.set $c (call $tsxByte (local.get $p)))
        (br_if $stop (i32.eqz (local.get $c)))
        (br_if $stop (i32.gt_u (local.get $c) (i32.const 32)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $skip)))
    (i32.and
      (i32.eq (local.get $c) (i32.const "="))
      (i32.eq (call $tsxByte (i32.add (local.get $p) (i32.const 1)))
        (i32.const ">"))))

  ;; advance the parameter-list machine for one classified token. $classify
  ;; calls this before classifying, so an identifier is judged under the
  ;; state its predecessors produced.
  (func $sigStep (param $prev i32) (param $t i32) (param $next i32)
        (param $lhs i32) (param $rhs i32)
    ;; `(`: one deeper; a pending head outside its type parameters marks it
    (if (i32.eq (local.get $t) (enum.get $Lex.l_paren))
      (then
        (global.set $sigParens (i32.add (global.get $sigParens) (i32.const 1)))
        (if (i32.eqz (global.get $sigFnAngle))
          (then
            (if (global.get $sigFnPend) (then (call $sigMark)))
            (global.set $sigFnPend (i32.const 0))))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Lex.r_paren))
      (then
        (if (call $sigActive) (then (call $sigUnmark)))
        (if (i32.gt_u (global.get $sigParens) (i32.const 0))
          (then (global.set $sigParens
            (i32.sub (global.get $sigParens) (i32.const 1)))))
        (return)))
    ;; heads that arm the machine for their upcoming `(`
    (if (i32.or (i32.eq (local.get $t) (enum.get $Lex.keyword_function))
                (i32.eq (local.get $t) (enum.get $Lex.keyword_catch)))
      (then
        (global.set $sigFnPend (i32.const 1))
        (global.set $sigFnAngle (i32.const 0))
        (return)))
    ;; `constructor(` and `get`/`set` accessor heads; a `.` before either
    ;; means a member access, which is a call
    (if (i32.eqz (i32.or
          (i32.eq (local.get $prev) (enum.get $Lex.dot))
          (i32.eq (local.get $prev) (enum.get $Lex.question_mark_dot))))
      (then
        (if (i32.and
              (i32.eq (local.get $t) (enum.get $Lex.identifier))
              (i32.eq (local.get $next) (enum.get $Lex.l_paren)))
          (then
            (if (call $isConstructorWord (local.get $lhs) (local.get $rhs))
              (then
                (global.set $sigFnPend (i32.const 1))
                (global.set $sigFnAngle (i32.const 0))
                (return)))))
        (if (i32.and
              (i32.or (i32.eq (local.get $t) (enum.get $Lex.ctxword_get))
                      (i32.eq (local.get $t) (enum.get $Lex.ctxword_set)))
              (call $isIdentish (local.get $next)))
          (then
            (global.set $sigFnPend (i32.const 1))
            (global.set $sigFnAngle (i32.const 0))
            (return)))))
    ;; a pending head survives its name, `*`, contextual words, and `<...>`
    ;; type parameters; any other token cancels it
    (if (global.get $sigFnPend)
      (then
        (if (i32.eq (local.get $t) (enum.get $Lex.l_angle))
          (then
            (global.set $sigFnAngle
              (i32.add (global.get $sigFnAngle) (i32.const 1)))
            (return)))
        (if (i32.eq (local.get $t) (enum.get $Lex.r_angle))
          (then (call $sigFnAngleDrop (i32.const 1)) (return)))
        (if (i32.eq (local.get $t) (enum.get $Lex.r_shift))
          (then (call $sigFnAngleDrop (i32.const 2)) (return)))
        (if (i32.eqz (i32.or
              (i32.ne (global.get $sigFnAngle) (i32.const 0))
              (i32.or
                (i32.eq (local.get $t) (enum.get $Lex.identifier))
                (i32.or
                  (i32.eq (local.get $t) (enum.get $Lex.asterisk))
                  (i32.and
                    (i32.ge_u (local.get $t) (enum.get $Lex.ctxword_as))
                    (i32.le_u (local.get $t) (enum.get $Lex.ctxword_type)))))))
          (then
            (global.set $sigFnPend (i32.const 0))
            (global.set $sigFnAngle (i32.const 0))))))
    ;; nesting inside a marked list: braces and brackets obscure the top
    ;; level (recording whether the first level opened in pattern position -
    ;; a destructured parameter - or in an expression, like a default value),
    ;; angles cover generic type arguments
    (if (i32.eqz (call $sigActive)) (then (return)))
    (if (i32.or (i32.eq (local.get $t) (enum.get $Lex.l_brace))
                (i32.eq (local.get $t) (enum.get $Lex.l_bracket)))
      (then
        (if (i32.eqz (global.get $sigObscure))
          (then (global.set $sigPattern (i32.or
            (i32.eq (local.get $prev) (enum.get $Lex.l_paren))
            (i32.eq (local.get $prev) (enum.get $Lex.comma))))))
        (global.set $sigObscure
          (i32.add (global.get $sigObscure) (i32.const 1)))
        (return)))
    (if (i32.or (i32.eq (local.get $t) (enum.get $Lex.r_brace))
                (i32.eq (local.get $t) (enum.get $Lex.r_bracket)))
      (then
        (if (i32.gt_u (global.get $sigObscure) (i32.const 0))
          (then (global.set $sigObscure
            (i32.sub (global.get $sigObscure) (i32.const 1)))))
        (return)))
    (if (i32.ne (global.get $sigObscure) (i32.const 0)) (then (return)))
    (if (i32.eq (local.get $t) (enum.get $Lex.semicolon))
      (then (call $sigUnmark) (return)))
    (if (i32.eq (local.get $t) (enum.get $Lex.l_angle))
      (then
        (global.set $sigAngle (i32.add (global.get $sigAngle) (i32.const 1)))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Lex.r_angle))
      (then (call $sigAngleDrop (i32.const 1)) (return)))
    (if (i32.eq (local.get $t) (enum.get $Lex.r_shift))
      (then (call $sigAngleDrop (i32.const 2)) (return)))
    (if (i32.eq (local.get $t) (enum.get $Lex.r_unsigned_shift))
      (then (call $sigAngleDrop (i32.const 3)))))

  ;; classify an identifier or contextual word from its neighbors
  (func $identHl (param $prev i32) (param $t i32) (param $next i32)
        (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    ;; contextual words in keyword position first (cheap heuristics)
    (if (i32.eq (local.get $t) (enum.get $Lex.ctxword_await))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.eq (local.get $t) (enum.get $Lex.ctxword_async))
      (then
        (if (i32.or (call $isIdentish (local.get $next))
                    (i32.eq (local.get $next) (enum.get $Lex.l_paren)))
          (then (return (enum.get $Token.keyword))))))
    (if (i32.eq (local.get $t) (enum.get $Lex.ctxword_of))
      (then
        (if (bitset.get $LexBits.exprEnd (local.get $prev))
          (then (return (enum.get $Token.keyword))))))
    (if (i32.eq (local.get $t) (enum.get $Lex.ctxword_keyof))
      (then
        (if (i32.or (call $isIdentish (local.get $next))
                    (i32.eq (local.get $next) (enum.get $Lex.l_paren)))
          (then (return (enum.get $Token.keyword))))))
    (if (i32.eq (local.get $t) (enum.get $Lex.ctxword_from))
      (then
        (if (i32.eq (local.get $next) (enum.get $Lex.string_literal))
          (then (return (enum.get $Token.keyword.import))))))
    (if (i32.eq (local.get $t) (enum.get $Lex.ctxword_as))
      (then
        (if (call $isIdentish (local.get $next))
          (then (return (enum.get $Token.keyword))))))
    ;; the remaining ctxwords - type/satisfies/is/declare/abstract/namespace/
    ;; readonly/override/infer/get/set - read as keywords before a name;
    ;; `type` introduces a declaration, so it lands in Zed's declaration bucket
    (if (i32.and (i32.ge_u (local.get $t) (enum.get $Lex.ctxword_get))
                 (i32.le_u (local.get $t) (enum.get $Lex.ctxword_type)))
      (then
        (if (i32.and
              (i32.ne (local.get $t) (enum.get $Lex.ctxword_of))
              (call $isIdentish (local.get $next)))
          (then
            (return (select
              (enum.get $Token.keyword.declaration) (enum.get $Token.keyword)
              (i32.eq (local.get $t) (enum.get $Lex.ctxword_type))))))))
    ;; member access
    (if (i32.or (i32.eq (local.get $prev) (enum.get $Lex.dot))
                (i32.eq (local.get $prev) (enum.get $Lex.question_mark_dot)))
      (then
        (if (i32.eq (local.get $next) (enum.get $Lex.l_paren))
          (then (return (enum.get $Token.function.method))))
        (return (enum.get $Token.property))))
    ;; parameter positions, mirroring Zed's @variable.parameter captures: an
    ;; arrow's sole parameter (`x =>` and `(x) =>`), a TS type-predicate
    ;; subject (`x is T`), the top level of a marked parameter list, and one
    ;; level into a destructured parameter pattern
    (if (i32.eq (local.get $next) (enum.get $Lex.function_arrow))
      (then (return (enum.get $Token.variable.parameter))))
    (if (i32.and
          (i32.eq (local.get $prev) (enum.get $Lex.l_paren))
          (i32.eq (local.get $next) (enum.get $Lex.r_paren)))
      (then
        (if (call $sigArrowAhead)
          (then (return (enum.get $Token.variable.parameter))))))
    (if (i32.and
          (i32.eq (local.get $next) (enum.get $Lex.ctxword_is))
          (call $ecmaHasTypeScript))
      (then (return (enum.get $Token.variable.parameter))))
    (if (call $sigActive)
      (then
        (if (i32.and
              (i32.eqz (i32.or (global.get $sigObscure) (global.get $sigAngle)))
              ;; normalized: bitset.get returns the masked byte, not 0/1
              (i32.ne
                (bitset.get $LexBits.sigParamPrev (local.get $prev))
                (i32.const 0)))
          (then (return (enum.get $Token.variable.parameter))))
        (if (i32.and
              (i32.and
                (i32.eq (global.get $sigObscure) (i32.const 1))
                (i32.ne (global.get $sigPattern) (i32.const 0)))
              (i32.and
                (i32.ne (local.get $next) (enum.get $Lex.colon))
                (i32.or
                  (i32.or
                    (i32.eq (local.get $prev) (enum.get $Lex.l_brace))
                    (i32.eq (local.get $prev) (enum.get $Lex.l_bracket)))
                  (i32.eq (local.get $prev) (enum.get $Lex.comma)))))
          (then (return (enum.get $Token.variable.parameter))))))
    ;; a TS `name:` (or `name?:`) annotation right after `(` proves a
    ;; parameter list - a call cannot contain one - so mark the list for the
    ;; names after later commas too. The pipeline already scanned $next, so
    ;; the tokenizer global $rhs is its end: the byte there is the one after
    ;; the `?`
    (if (i32.and
          (i32.eq (local.get $prev) (enum.get $Lex.l_paren))
          (call $ecmaHasTypeScript))
      (then
        (if (i32.or
              (i32.eq (local.get $next) (enum.get $Lex.colon))
              (i32.and
                (i32.eq (local.get $next) (enum.get $Lex.question_mark))
                (i32.eq (call $tsxByte (global.get $rhs)) (i32.const ":"))))
          (then
            (call $sigMark)
            (return (enum.get $Token.variable.parameter))))))
    (if (call $isBuiltinConst (local.get $lhs) (local.get $rhs))
      (then (return (enum.get $Token.constant.builtin))))
    ;; nested so the word compare only runs for identifiers after a colon
    (if (i32.and
          (i32.eq (local.get $prev) (enum.get $Lex.colon))
          (call $ecmaHasTypeScript))
      (then
        (if (call $isPredefinedType (local.get $lhs) (local.get $rhs))
          (then (return (enum.get $Token.type.builtin))))))
    (if (i32.eq (local.get $prev) (enum.get $Lex.keyword_new))
      (then (return (enum.get $Token.type.class))))
    ;; declared type names, before the SCREAMING_CASE constant rule can fire:
    ;; class/extends heads are Zed's type.class, interface/enum/type names type
    (if (i32.or (i32.eq (local.get $prev) (enum.get $Lex.keyword_class))
                (i32.eq (local.get $prev) (enum.get $Lex.keyword_extends)))
      (then (return (enum.get $Token.type.class))))
    (if (i32.or
          (i32.or (i32.eq (local.get $prev) (enum.get $Lex.keyword_interface))
                  (i32.eq (local.get $prev) (enum.get $Lex.keyword_enum)))
          (i32.eq (local.get $prev) (enum.get $Lex.ctxword_type)))
      (then (return (enum.get $Token.type))))
    (if (i32.eq (local.get $prev) (enum.get $Lex.keyword_function))
      (then (return (enum.get $Token.function))))
    ;; object / type-member key: `{`/`,`/`;` before - `;` separates interface
    ;; and type-literal members - and `:` after, or `?` when the `:` follows it
    ;; directly (a TS optional member; a ternary `?` never touches its `:`).
    ;; the pipeline already scanned $next, so the tokenizer global $rhs - not
    ;; the $rhs param, the current token's end - is its end: the byte there is
    ;; the one after the `?`
    (if (i32.and
          (i32.or
            (i32.or (i32.eq (local.get $prev) (enum.get $Lex.l_brace))
                    (i32.eq (local.get $prev) (enum.get $Lex.comma)))
            (i32.and
              (call $ecmaHasTypeScript)
              (i32.eq (local.get $prev) (enum.get $Lex.semicolon))))
          (i32.or
            (i32.eq (local.get $next) (enum.get $Lex.colon))
            (i32.and
              (call $ecmaHasTypeScript)
              (i32.and
                (i32.eq (local.get $next) (enum.get $Lex.question_mark))
                (i32.eq (call $tsxByte (global.get $rhs)) (i32.const ":"))))))
      (then (return (enum.get $Token.property))))
    (if (i32.eq (local.get $next) (enum.get $Lex.l_paren))
      (then (return (enum.get $Token.function))))
    ;; SCREAMING_CASE names are constants - Zed's ^_*[A-Z_][A-Z\d_]*$ rule -
    ;; and other Uppercase-initial names are types, deliberately
    (if (call $isConstCase (local.get $lhs) (local.get $rhs))
      (then (return (enum.get $Token.constant))))
    (local.set $c (i32.load8_u (local.get $lhs)))
    (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
      (then (return (enum.get $Token.type))))
    (enum.get $Token.variable))

  ;; every byte in [A-Z0-9_], with an identifier-start first byte: the token
  ;; reads as a SCREAMING_CASE constant
  (func $isConstCase (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    (block $no
      (loop $l
        (if (i32.ge_u (local.get $lhs) (local.get $rhs))
          (then (return (i32.const 1))))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (block $ok
          (br_if $ok (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))
          (br_if $ok (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9)))
          (br_if $ok (i32.eq (local.get $c) (i32.const "_")))
          (br $no))
        (local.set $lhs (i32.add (local.get $lhs) (i32.const 1)))
        (br $l)))
    (i32.const 0))

  ;; classify a single-span token from (prev, cur, next); multi-part kinds
  ;; - strings, templates, comments - are handled by the pipeline itself
  (func $classify (param $prev i32) (param $t i32) (param $next i32)
        (param $lhs i32) (param $rhs i32) (result i32)
    (call $sigStep (local.get $prev) (local.get $t) (local.get $next)
      (local.get $lhs) (local.get $rhs))
    ;; nested so the word compare only runs for a colon before an identifier -
    ;; wasm i32.and is eager, and this classifier runs for every token
    (if (i32.and
          (i32.eq (local.get $t) (enum.get $Lex.colon))
          (i32.and
            (i32.eq (local.get $next) (enum.get $Lex.identifier))
            (call $ecmaHasTypeScript)))
      (then
        (if (i32.or
              (i32.le_u
                (i32.sub (call $tsxByte (global.get $lhs)) (i32.const "A"))
                (i32.const 25))
              (call $isPredefinedType (global.get $lhs) (global.get $rhs)))
          (then (return (enum.get $Token.punctuation.special))))))
    (if (i32.and
          (call $ecmaHasTypeScript)
          (i32.and
            (i32.eq (local.get $t) (enum.get $Lex.question_mark))
            (i32.eq (local.get $next) (enum.get $Lex.colon))))
      (then (return (enum.get $Token.punctuation.special))))
    (if (i32.or
          (i32.or
            (i32.or (i32.eq (local.get $t) (enum.get $Lex.l_paren))
                    (i32.eq (local.get $t) (enum.get $Lex.r_paren)))
            (i32.or (i32.eq (local.get $t) (enum.get $Lex.l_bracket))
                    (i32.eq (local.get $t) (enum.get $Lex.r_bracket))))
          (i32.or (i32.eq (local.get $t) (enum.get $Lex.l_brace))
                  (i32.eq (local.get $t) (enum.get $Lex.r_brace))))
      (then (return (enum.get $Token.punctuation.bracket))))
    (if (i32.or
          (i32.or
            (i32.or (i32.eq (local.get $t) (enum.get $Lex.comma))
                    (i32.eq (local.get $t) (enum.get $Lex.semicolon)))
            (i32.or (i32.eq (local.get $t) (enum.get $Lex.colon))
                    (i32.eq (local.get $t) (enum.get $Lex.dot))))
          (i32.eq (local.get $t) (enum.get $Lex.question_mark_dot)))
      (then (return (enum.get $Token.punctuation.delimiter))))
    (if (i32.or (i32.eq (local.get $t) (enum.get $Lex.number_literal))
                (i32.eq (local.get $t) (enum.get $Lex.bigint_literal)))
      (then (return (enum.get $Token.number))))
    (if (i32.eq (local.get $t) (enum.get $Lex.regexp_literal))
      (then (return (enum.get $Token.string.regex))))
    (if (i32.eq (local.get $t) (enum.get $Lex.at_identifier))
      (then (return (enum.get $Token.attribute))))
    (if (i32.eq (local.get $t) (enum.get $Lex.hash_identifier))
      (then (return (enum.get $Token.property))))
    (if (i32.or
          (i32.eq (local.get $t) (enum.get $Lex.identifier))
          (i32.and (i32.ge_u (local.get $t) (enum.get $Lex.ctxword_as))
                   (i32.le_u (local.get $t) (enum.get $Lex.ctxword_type))))
      (then (return (call $identHl (local.get $prev) (local.get $t) (local.get $next)
                                   (local.get $lhs) (local.get $rhs)))))
    (if (i32.and (i32.ge_u (local.get $t) (enum.get $Lex.keyword_break))
                 (i32.le_u (local.get $t) (enum.get $Lex.keyword_yield)))
      (then (return (call $kwHl (local.get $t)))))
    ;; every remaining token below the keyword range is an operator
    (if (i32.and (i32.ge_u (local.get $t) (enum.get $Lex.ampersand_ampersand_equal))
                 (i32.le_u (local.get $t) (enum.get $Lex.yield_asterisk)))
      (then (return (enum.get $Token.operator))))
    (enum.get $Token.none))

  (func $hlTs (call $hlEcma (i32.const 1)))
  (func $hlTsStream (param $reset i32)
    (call $hlEcmaStream (i32.const 1) (local.get $reset)))
)
