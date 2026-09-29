(module
  ;; TypeScript-aware semantic classification shared by TS and TSX.
  (enum-map $LexHl $Lex $mem.jsTokenHighlightMap $Token.operator
    (value 253
      "eof" "invalid" "comment" "multiline_comment" "hash_bang" "string_literal" "backtick"
      "dollar_brace")
    (value 254 "colon" "question_mark")
    (value 255
      "identifier" "ctxword_as" "ctxword_async" "ctxword_await" "ctxword_from" "ctxword_get"
      "ctxword_of" "ctxword_set" "ctxword_abstract" "ctxword_declare" "ctxword_infer" "ctxword_is"
      "ctxword_keyof" "ctxword_namespace" "ctxword_override" "ctxword_readonly" "ctxword_satisfies"
      "ctxword_type")
    (value $Token.punctuation.bracket
      "l_paren" "r_paren" "l_bracket" "r_bracket" "l_brace" "r_brace")
    (value $Token.punctuation.delimiter "comma" "semicolon" "dot" "question_mark_dot")
    (value $Token.number "number_literal" "bigint_literal")
    (value $Token.string.regex "regexp_literal")
    (value $Token.attribute "at_identifier")
    (value $Token.property "hash_identifier")
    (value $Token.keyword.control
      "keyword_if" "keyword_else" "keyword_switch" "keyword_case" "keyword_default" "keyword_for"
      "keyword_while" "keyword_do" "keyword_return" "keyword_try" "keyword_catch" "keyword_finally"
      "keyword_throw" "keyword_break" "keyword_continue" "keyword_yield")
    (value $Token.keyword.declaration
      "keyword_const" "keyword_let" "keyword_var" "keyword_function" "keyword_class" "keyword_enum"
      "keyword_interface")
    (value $Token.keyword.import "keyword_import" "keyword_export")
    (value $Token.boolean "keyword_true" "keyword_false")
    (value $Token.constant.builtin "keyword_null")
    (value $Token.variable.special "keyword_this" "keyword_super")
    (value $Token.keyword
      "keyword_debugger" "keyword_delete" "keyword_extends" "keyword_in" "keyword_instanceof"
      "keyword_new" "keyword_typeof" "keyword_void" "keyword_with" "keyword_implements"
      "keyword_package" "keyword_private" "keyword_protected" "keyword_public" "keyword_static"))

  ;; identifier-like next token: an identifier, keyword, or contextual word -
  ;; the cheap "does this ctxword read as a keyword here" test
  (func $isIdentish (param $t i32) (result i32)
    (i32.or
      (i32.eq (local.get $t) (enum.get $Lex.identifier))
      (i32.and
        (i32.ge_u (local.get $t) (enum.get $Lex.keyword_break))
        (i32.le_u (local.get $t) (enum.get $Lex.ctxword_type)))))

  ;; undefined / NaN / Infinity spelled out
  (func $isBuiltinConst (param $lhs i32) (param $rhs i32) (result i32)
    (local $len i32)
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.eq (local.get $len) (i32.const 9))
      (then
        (return
          (i32.and
            (i64.eq (i64.load (local.get $lhs)) (i64.const "undefine"))
            (i32.eq (i32.load8_u offset=8 (local.get $lhs)) (i32.const "d"))))))
    (if (i32.eq (local.get $len) (i32.const 3))
      (then
        (return
          (i32.eq (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff)) (i32.const "NaN")))))
    (if (i32.eq (local.get $len) (i32.const 8))
      (then (return (i64.eq (i64.load (local.get $lhs)) (i64.const "Infinity")))))
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
      (then
        (return (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "never")))))
    (if (i32.eq (local.get $len) (i32.const 6))
      (then
        (local.set $w (i64.and (local.get $w) (i64.const 0xffffffffffff)))
        (return
          (i32.or
            (i32.or
              (i64.eq (local.get $w) (i64.const "number"))
              (i64.eq (local.get $w) (i64.const "string")))
            (i32.or
              (i64.eq (local.get $w) (i64.const "symbol"))
              (i64.eq (local.get $w) (i64.const "object")))))))
    (if (i32.eq (local.get $len) (i32.const 7))
      (then
        (local.set $w (i64.and (local.get $w) (i64.const 0xffffffffffffff)))
        (return
          (i32.or
            (i64.eq (local.get $w) (i64.const "boolean"))
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

  ;; the address after the blanks (spaces, tabs) that end just before $p,
  ;; never below the input base: a same-line look-back, so line-fed chunks
  ;; see what whole-buffer runs see
  (func $tsBlanksBefore (param $p i32) (result i32)
    (local $c i32)
    (block $done
      (loop $back
        (br_if $done (i32.le_u (local.get $p) (global.get $srcBase)))
        (local.set $c (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))
        (br_if $done (i32.eqz (i32.or (i32.eq (local.get $c) (i32.const 32)) (i32.eq (local.get $c) (i32.const 9)))))
        (local.set $p (i32.sub (local.get $p) (i32.const 1)))
        (br $back)))
    (local.get $p))

  ;; byte before $p, or 0 at the input base
  (func $tsByteBefore (param $p i32) (result i32)
    (if (i32.le_u (local.get $p) (global.get $srcBase))
      (then (return (i32.const 0))))
    (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))

  ;; is the `:` before the token at $lhs a return-type colon - `): T` - on
  ;; the same line? The pipeline keeps one token of history, so the `)` two
  ;; tokens back is read from the bytes
  (func $tsReturnColonBefore (param $lhs i32) (result i32)
    (local $p i32)
    (local.set $p (call $tsBlanksBefore (local.get $lhs)))
    (if (i32.ne (call $tsByteBefore (local.get $p)) (i32.const ":"))
      (then (return (i32.const 0))))
    (i32.eq
      (call $tsByteBefore (call $tsBlanksBefore (i32.sub (local.get $p) (i32.const 1))))
      (i32.const ")")))

  ;; is the name at $lhs, right before `=>`, the end of a TS arrow return
  ;; type rather than the arrow's sole parameter? After `): `, a type
  ;; predicate's `is`, or a union/intersection operator - no arrow function
  ;; can be an operand of `|` or `&`. An object value `{ k: e => ... }` keeps
  ;; its parameter
  (func $tsArrowReturnType (param $prev i32) (param $lhs i32) (result i32)
    (if (i32.eqz (call $ecmaHasTypeScript))
      (then (return (i32.const 0))))
    (if
      (i32.or
        (i32.eq (local.get $prev) (enum.get $Lex.ctxword_is))
        (i32.or
          (i32.eq (local.get $prev) (enum.get $Lex.pipe))
          (i32.eq (local.get $prev) (enum.get $Lex.ampersand))))
      (then (return (i32.const 1))))
    (if (i32.eq (local.get $prev) (enum.get $Lex.colon))
      (then (return (call $tsReturnColonBefore (local.get $lhs)))))
    (i32.const 0))

  ;; is the member at $lhs the class of `new a.b.C` on the same line? Walks
  ;; the dotted chain back to the `new` keyword
  (func $tsNewMemberBefore (param $lhs i32) (result i32)
    (local $p i32)
    (local $c i32)
    (local.set $p (local.get $lhs))
    (block $chainDone
      (loop $chain
        (br_if $chainDone (i32.ne (call $tsByteBefore (local.get $p)) (i32.const ".")))
        (local.set $p (i32.sub (local.get $p) (i32.const 1)))
        (block $nameDone
          (loop $name
            (local.set $c (call $tsByteBefore (local.get $p)))
            (br_if $nameDone
              (i32.eqz
                (i32.or
                  (call $jsxNameStart (local.get $c))
                  (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9)))))
            (local.set $p (i32.sub (local.get $p) (i32.const 1)))
            (br $name)))
        (br $chain)))
    (local.set $p (call $tsBlanksBefore (local.get $p)))
    (if (i32.lt_u (i32.sub (local.get $p) (global.get $srcBase)) (i32.const 3))
      (then (return (i32.const 0))))
    (i32.and
      (i32.eq
        (i32.and (i32.load (i32.sub (local.get $p) (i32.const 3))) (i32.const 0xffffff))
        (i32.const "new"))
      (i32.eqz (call $jsxNameStart (call $tsByteBefore (i32.sub (local.get $p) (i32.const 3)))))))

  ;; is a SCREAMING_CASE-shaped TS name in a type position, where it reads
  ;; as a type (`T`, `K`, `FC`) rather than a constant? After a type
  ;; operator (`keyof`, `infer`, `is`, `as`, `satisfies`); inside `<...>`
  ;; (`<T>`, `<K, V>`, `<T extends U>`, `<T = X>`, `<const T,>`); a mapped-type key
  ;; `[K in`; the last union member of an arrow return type `| T =>`; and an
  ;; annotation - inside a marked parameter list, a return type `): T`, or a
  ;; generic reference `: FC<`. A `:` in an object literal and bitwise `|`
  ;; keep their constant values
  (func $tsTypeSlot (param $prev i32) (param $next i32) (param $lhs i32) (result i32)
    (if
      (i32.or
        (i32.or
          (i32.eq (local.get $prev) (enum.get $Lex.ctxword_keyof))
          (i32.eq (local.get $prev) (enum.get $Lex.ctxword_infer)))
        (i32.or
          (i32.eq (local.get $prev) (enum.get $Lex.ctxword_is))
          (i32.or
            (i32.eq (local.get $prev) (enum.get $Lex.ctxword_as))
            (i32.eq (local.get $prev) (enum.get $Lex.ctxword_satisfies)))))
      (then (return (i32.const 1))))
    ;; the rules below read the next token, which must share the line: a
    ;; line-fed chunk ends before a next line's token arrives
    (if (global.get $nlBefore)
      (then (local.set $next (enum.get $Lex.eof))))
    ;; `<const T,>`: a const type parameter
    (if (i32.eq (local.get $prev) (enum.get $Lex.keyword_const))
      (then
        (return
          (i32.or
            (i32.or
              (i32.eq (local.get $next) (enum.get $Lex.comma))
              (i32.eq (local.get $next) (enum.get $Lex.r_angle)))
            (i32.eq (local.get $next) (enum.get $Lex.keyword_extends))))))
    (if (i32.or (i32.eq (local.get $prev) (enum.get $Lex.l_angle)) (i32.eq (local.get $prev) (enum.get $Lex.comma)))
      (then
        (return
          (i32.or
            (i32.or
              (i32.eq (local.get $next) (enum.get $Lex.r_angle))
              (i32.eq (local.get $next) (enum.get $Lex.r_shift)))
            (i32.or
              (i32.eq (local.get $next) (enum.get $Lex.keyword_extends))
              (i32.and
                (i32.eq (local.get $prev) (enum.get $Lex.l_angle))
                (i32.or
                  (i32.eq (local.get $next) (enum.get $Lex.comma))
                  (i32.eq (local.get $next) (enum.get $Lex.equal)))))))))
    (if (i32.eq (local.get $prev) (enum.get $Lex.l_bracket))
      (then (return (i32.eq (local.get $next) (enum.get $Lex.keyword_in)))))
    ;; the last member of a union or intersection return type, `): A | T =>`
    (if (i32.or (i32.eq (local.get $prev) (enum.get $Lex.pipe)) (i32.eq (local.get $prev) (enum.get $Lex.ampersand)))
      (then (return (i32.eq (local.get $next) (enum.get $Lex.function_arrow)))))
    (if (i32.eq (local.get $prev) (enum.get $Lex.colon))
      (then
        (if (i32.eq (local.get $next) (enum.get $Lex.l_angle))
          (then (return (i32.const 1))))
        (if (call $sigActive)
          (then
            (if (i32.eqz (global.get $sigObscure))
              (then (return (i32.const 1))))))
        (return (call $tsReturnColonBefore (local.get $lhs)))))
    (i32.const 0))

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
      (i32.eq (call $tsxByte (i32.add (local.get $p) (i32.const 1))) (i32.const ">"))))

  ;; advance the parameter-list machine for one classified token. $classify
  ;; calls this before classifying, so an identifier is judged under the
  ;; state its predecessors produced.
  (func $sigStep
    (param $prev i32)
    (param $t i32)
    (param $next i32)
    (param $lhs i32)
    (param $rhs i32)
    ;; idle machine - no pending head, no marked list: only parens, heads,
    ;; and head-like words can change it
    (if
      (i32.eqz
        (i32.or
          (i32.or (global.get $sigFnPend) (global.get $sigMask))
          (bitset.get $LexBits.sigIdle (local.get $t))))
      (then (return)))
    ;; `(`: one deeper; a pending head outside its type parameters marks it
    (if (i32.eq (local.get $t) (enum.get $Lex.l_paren))
      (then
        (global.set $sigParens (i32.add (global.get $sigParens) (i32.const 1)))
        (if (i32.eqz (global.get $sigFnAngle))
          (then
            (if (global.get $sigFnPend)
              (then (call $sigMark)))
            (global.set $sigFnPend (i32.const 0))))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Lex.r_paren))
      (then
        (if (call $sigActive)
          (then (call $sigUnmark)))
        (if (i32.gt_u (global.get $sigParens) (i32.const 0))
          (then (global.set $sigParens (i32.sub (global.get $sigParens) (i32.const 1)))))
        (return)))
    ;; heads that arm the machine for their upcoming `(`
    (if
      (i32.or
        (i32.eq (local.get $t) (enum.get $Lex.keyword_function))
        (i32.eq (local.get $t) (enum.get $Lex.keyword_catch)))
      (then
        (global.set $sigFnPend (i32.const 1))
        (global.set $sigFnAngle (i32.const 0))
        (return)))
    ;; `constructor(` and `get`/`set` accessor heads; a `.` before either
    ;; means a member access, which is a call
    (if
      (i32.eqz
        (i32.or
          (i32.eq (local.get $prev) (enum.get $Lex.dot))
          (i32.eq (local.get $prev) (enum.get $Lex.question_mark_dot))))
      (then
        (if
          (i32.and
            (i32.eq (local.get $t) (enum.get $Lex.identifier))
            (i32.eq (local.get $next) (enum.get $Lex.l_paren)))
          (then
            (if (call $isConstructorWord (local.get $lhs) (local.get $rhs))
              (then
                (global.set $sigFnPend (i32.const 1))
                (global.set $sigFnAngle (i32.const 0))
                (return)))))
        (if
          (i32.and
            (i32.or
              (i32.eq (local.get $t) (enum.get $Lex.ctxword_get))
              (i32.eq (local.get $t) (enum.get $Lex.ctxword_set)))
            (i32.or
              (call $isIdentish (local.get $next))
              (i32.eq (local.get $next) (enum.get $Lex.hash_identifier))))
          (then
            (global.set $sigFnPend (i32.const 1))
            (global.set $sigFnAngle (i32.const 0))
            (return)))))
    ;; a pending head survives its name (`#x` included), `*`, contextual
    ;; words, and `<...>` type parameters; any other token cancels it
    (if (global.get $sigFnPend)
      (then
        (if (i32.eq (local.get $t) (enum.get $Lex.l_angle))
          (then
            (global.set $sigFnAngle (i32.add (global.get $sigFnAngle) (i32.const 1)))
            (return)))
        (if (i32.eq (local.get $t) (enum.get $Lex.r_angle))
          (then
            (call $sigFnAngleDrop (i32.const 1))
            (return)))
        (if (i32.eq (local.get $t) (enum.get $Lex.r_shift))
          (then
            (call $sigFnAngleDrop (i32.const 2))
            (return)))
        (if
          (i32.eqz
            (i32.or
              (i32.ne (global.get $sigFnAngle) (i32.const 0))
              (i32.or
                (i32.or
                  (i32.eq (local.get $t) (enum.get $Lex.identifier))
                  (i32.eq (local.get $t) (enum.get $Lex.hash_identifier)))
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
    (if (i32.eqz (call $sigActive))
      (then (return)))
    (if
      (i32.or
        (i32.eq (local.get $t) (enum.get $Lex.l_brace))
        (i32.eq (local.get $t) (enum.get $Lex.l_bracket)))
      (then
        (if (i32.eqz (global.get $sigObscure))
          (then
            (global.set $sigPattern
              (i32.or
                (i32.or
                  (i32.eq (local.get $prev) (enum.get $Lex.l_paren))
                  (i32.eq (local.get $prev) (enum.get $Lex.comma)))
                ;; a TSRX lazy pattern `&{ }` / `&[ ]` in parameter position
                (i32.and
                  (call $ecmaHasTsrx)
                  (i32.eq (local.get $prev) (enum.get $Lex.ampersand)))))))
        (global.set $sigObscure (i32.add (global.get $sigObscure) (i32.const 1)))
        (return)))
    (if
      (i32.or
        (i32.eq (local.get $t) (enum.get $Lex.r_brace))
        (i32.eq (local.get $t) (enum.get $Lex.r_bracket)))
      (then
        (if (i32.gt_u (global.get $sigObscure) (i32.const 0))
          (then (global.set $sigObscure (i32.sub (global.get $sigObscure) (i32.const 1)))))
        (return)))
    (if (i32.ne (global.get $sigObscure) (i32.const 0))
      (then (return)))
    (if (i32.eq (local.get $t) (enum.get $Lex.semicolon))
      (then
        (call $sigUnmark)
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Lex.l_angle))
      (then
        (global.set $sigAngle (i32.add (global.get $sigAngle) (i32.const 1)))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Lex.r_angle))
      (then
        (call $sigAngleDrop (i32.const 1))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Lex.r_shift))
      (then
        (call $sigAngleDrop (i32.const 2))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Lex.r_unsigned_shift))
      (then (call $sigAngleDrop (i32.const 3)))))

  ;; a contextual word in keyword position: its keyword bucket, or -1 when it
  ;; reads as an ordinary name here (cheap neighbour heuristics)
  (func $ctxwordHl (param $prev i32) (param $t i32) (param $next i32) (result i32)
    ;; A type alias requires its name on the same line. Outside import/export
    ;; clauses, a trailing `type` stays a name in both whole and line-fed input.
    (if (i32.and
          (i32.eq (local.get $t) (enum.get $Lex.ctxword_type))
          (i32.and (global.get $nlBefore) (i32.eqz (global.get $ecmaImport))))
      (then (return (i32.const -1))))
    ;; At a completed line, the next operand may not have arrived yet. Use
    ;; the preceding import/export clause instead of requiring it.
    (if (i32.and (i32.eq (local.get $next) (enum.get $Lex.eof)) (global.get $nlBefore))
      (then
        (if (i32.and
              (i32.and (global.get $ecmaImport) (i32.eq (local.get $t) (enum.get $Lex.ctxword_from)))
              (i32.or
                (i32.eq (local.get $prev) (enum.get $Lex.identifier))
                (i32.or
                  (i32.or
                    (i32.eq (local.get $prev) (enum.get $Lex.ctxword_from))
                    (i32.eq (local.get $prev) (enum.get $Lex.ctxword_type)))
                  (i32.or
                    (i32.eq (local.get $prev) (enum.get $Lex.r_brace))
                    (i32.eq (local.get $prev) (enum.get $Lex.asterisk))))))
          (then (return (enum.get $Token.keyword.import))))
        (if (i32.and
              (i32.and (call $ecmaHasTypeScript) (i32.eq (local.get $t) (enum.get $Lex.ctxword_type)))
              (i32.and (global.get $ecmaImport)
                (i32.or
                  (i32.or
                    (i32.eq (local.get $prev) (enum.get $Lex.keyword_export))
                    (i32.eq (local.get $prev) (enum.get $Lex.keyword_import)))
                  (i32.or
                    (i32.eq (local.get $prev) (enum.get $Lex.l_brace))
                    (i32.eq (local.get $prev) (enum.get $Lex.comma))))))
          (then (return (enum.get $Token.keyword.declaration))))))
    (if (i32.eq (local.get $t) (enum.get $Lex.ctxword_await))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.eq (local.get $t) (enum.get $Lex.ctxword_async))
      (then
        (if
          (i32.or
            (call $isIdentish (local.get $next))
            (i32.eq (local.get $next) (enum.get $Lex.l_paren)))
          (then (return (enum.get $Token.keyword))))))
    (if (i32.eq (local.get $t) (enum.get $Lex.ctxword_of))
      (then
        (if (bitset.get $LexBits.exprEnd (local.get $prev))
          (then (return (enum.get $Token.keyword))))))
    (if (i32.eq (local.get $t) (enum.get $Lex.ctxword_keyof))
      (then
        (if
          (i32.or
            (call $isIdentish (local.get $next))
            (i32.eq (local.get $next) (enum.get $Lex.l_paren)))
          (then (return (enum.get $Token.keyword))))))
    (if (i32.eq (local.get $t) (enum.get $Lex.ctxword_from))
      (then
        (if (i32.eq (local.get $next) (enum.get $Lex.string_literal))
          (then (return (enum.get $Token.keyword.import))))
        ;; TSRX imports from a declared submodule by its name
        (if (i32.and (call $ecmaHasTsrx) (i32.eq (local.get $next) (enum.get $Lex.identifier)))
          (then (return (enum.get $Token.keyword.import))))))
    (if (i32.eq (local.get $t) (enum.get $Lex.ctxword_as))
      (then
        (if (call $isIdentish (local.get $next))
          (then (return (enum.get $Token.keyword))))))
    ;; the remaining ctxwords - type/satisfies/is/declare/abstract/namespace/
    ;; readonly/override/infer/get/set - read as keywords before a name;
    ;; `type` introduces a declaration, so it lands in Zed's declaration bucket.
    ;; Accessors also name private members (`get #x()`), and `readonly`
    ;; also marks index signatures and mapped types (`readonly [K in T]`)
    (if
      (i32.and
        (i32.ge_u (local.get $t) (enum.get $Lex.ctxword_get))
        (i32.le_u (local.get $t) (enum.get $Lex.ctxword_type)))
      (then
        (if
          (i32.and
            (i32.ne (local.get $t) (enum.get $Lex.ctxword_of))
            (i32.or
              (call $isIdentish (local.get $next))
              (i32.and
                (i32.eqz (global.get $nlBefore))
                (i32.or
                  (i32.and
                    (i32.eq (local.get $next) (enum.get $Lex.hash_identifier))
                    (i32.or
                      (i32.eq (local.get $t) (enum.get $Lex.ctxword_get))
                      (i32.eq (local.get $t) (enum.get $Lex.ctxword_set))))
                  (i32.and
                    (i32.eq (local.get $next) (enum.get $Lex.l_bracket))
                    (i32.and
                      (i32.eq (local.get $t) (enum.get $Lex.ctxword_readonly))
                      (i32.ne (local.get $prev) (enum.get $Lex.dot))))))))
          (then
            (return
              (select
                (enum.get $Token.keyword.declaration)
                (enum.get $Token.keyword)
                (i32.eq (local.get $t) (enum.get $Lex.ctxword_type))))))))
    (i32.const -1))

  ;; contextual words the keyword table does not carry, recognized from
  ;; their neighbours: `using x` (explicit resource management), `accessor x`
  ;; and `accessor #x` (auto-accessors), and TS `declare global {`,
  ;; `module 'm'` / `module Foo`, `unique symbol`, and `asserts v` after an
  ;; annotation colon. Returns the token, or -1 for an ordinary name. A
  ;; plain identifier before a name, a string, `{`, or `#x` is rare, so the
  ;; word compares seldom run
  (func $ctxIdentHl (param $prev i32) (param $next i32) (param $lhs i32) (param $rhs i32) (result i32)
    (local $len i32)
    (local $w i64)
    (local $name i32)
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))
    (local.set $w (i64.load (local.get $lhs)))
    (if (i32.eq (local.get $next) (enum.get $Lex.l_brace))
      (then
        (if
          (i32.and
            (i32.eq (local.get $prev) (enum.get $Lex.ctxword_declare))
            (i32.and
              (i32.eq (local.get $len) (i32.const 6))
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "global"))))
          (then (return (enum.get $Token.keyword))))
        (return (i32.const -1))))
    ;; a following name: an identifier or a contextual word other than `of`
    (local.set $name
      (i32.or
        (i32.eq (local.get $next) (enum.get $Lex.identifier))
        (i32.and
          (i32.ge_u (local.get $next) (enum.get $Lex.ctxword_as))
          (i32.ne (local.get $next) (enum.get $Lex.ctxword_of)))))
    (if (i32.eq (local.get $len) (i32.const 5))
      (then
        (if
          (i32.and
            (local.get $name)
            (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "using")))
          (then (return (enum.get $Token.keyword.declaration))))
        (return (i32.const -1))))
    (if (i32.eq (local.get $len) (i32.const 8))
      (then
        (if
          (i32.and
            (i32.or (local.get $name) (i32.eq (local.get $next) (enum.get $Lex.hash_identifier)))
            (i64.eq (local.get $w) (i64.const "accessor")))
          (then (return (enum.get $Token.keyword))))
        (return (i32.const -1))))
    (if (i32.eqz (call $ecmaHasTypeScript))
      (then (return (i32.const -1))))
    (if (i32.eq (local.get $len) (i32.const 6))
      (then
        (local.set $w (i64.and (local.get $w) (i64.const 0xffffffffffff)))
        (if
          (i32.and
            (i32.or (local.get $name) (i32.eq (local.get $next) (enum.get $Lex.string_literal)))
            (i64.eq (local.get $w) (i64.const "module")))
          (then (return (enum.get $Token.keyword))))
        (if (i32.and (local.get $name) (i64.eq (local.get $w) (i64.const "unique")))
          (then (return (enum.get $Token.keyword))))
        (return (i32.const -1))))
    (if
      (i32.and
        (i32.and
          (i32.eq (local.get $len) (i32.const 7))
          (i32.eq (local.get $prev) (enum.get $Lex.colon)))
        (i32.or (local.get $name) (i32.eq (local.get $next) (enum.get $Lex.keyword_this))))
      (then
        (if (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffffff)) (i64.const "asserts"))
          (then (return (enum.get $Token.keyword))))))
    (i32.const -1))

  ;; classify an identifier or contextual word from its neighbors
  (func $identHl
    (param $prev i32)
    (param $t i32)
    (param $next i32)
    (param $lhs i32)
    (param $rhs i32)
    (result i32)
    (local $c i32)
    ;; a plain identifier - the common case - skips the contextual-word tests
    ;; unless the next token could complete one of the table-less words on
    ;; the same line
    (if (i32.ne (local.get $t) (enum.get $Lex.identifier))
      (then
        (local.set $c (call $ctxwordHl (local.get $prev) (local.get $t) (local.get $next)))
        (if (i32.ne (local.get $c) (i32.const -1))
          (then (return (local.get $c)))))
      (else
        (if (bitset.get $LexBits.ctxIdentNext (local.get $next))
          (then
            (if
              (i32.eqz
                (i32.or
                  (global.get $nlBefore)
                  (i32.or
                    (i32.eq (local.get $prev) (enum.get $Lex.dot))
                    (i32.eq (local.get $prev) (enum.get $Lex.question_mark_dot)))))
              (then
                (local.set $c
                  (call $ctxIdentHl (local.get $prev) (local.get $next) (local.get $lhs) (local.get $rhs)))
                (if (i32.ne (local.get $c) (i32.const -1))
                  (then (return (local.get $c))))))))))
    ;; member access. The member called in `new ns.Class()` is the class
    (if
      (i32.or
        (i32.eq (local.get $prev) (enum.get $Lex.dot))
        (i32.eq (local.get $prev) (enum.get $Lex.question_mark_dot)))
      (then
        (if (i32.eq (local.get $next) (enum.get $Lex.l_paren))
          (then
            (if (i32.le_u (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25))
              (then
                (if (call $tsNewMemberBefore (local.get $lhs))
                  (then (return (enum.get $Token.type.class))))))
            (return (enum.get $Token.function.method))))
        (return (enum.get $Token.property))))
    (if (call $ecmaHasTsrx)
      (then
        ;; `module name {` declares a submodule
        (if (i32.eq (local.get $prev) (enum.get $Lex.ctxword_namespace))
          (then (return (enum.get $Token.namespace))))
        ;; `@for (const x of xs; index i; key x.id)`: the clause words after a
        ;; `;` inside a control paren, right before their operand
        (if
          (i32.and
            (i32.eq (local.get $prev) (enum.get $Lex.semicolon))
            (i32.eq (local.get $next) (enum.get $Lex.identifier)))
          (then
            (if
              (i32.and
                (i32.eq (call $brkTopKind) (i32.const 1))
                (call $tsrxForClauseWord (local.get $lhs) (local.get $rhs)))
              (then (return (enum.get $Token.keyword))))))))
    ;; parameter positions, mirroring Zed's @variable.parameter captures: an
    ;; arrow's sole parameter (`x =>` and `(x) =>`), a TS type-predicate
    ;; subject (`x is T`), the top level of a marked parameter list, and one
    ;; level into a destructured parameter pattern
    ;; ... except a TS return type right before the `=>`: `(a): T =>`,
    ;; `(x): x is T =>`, `(): A | B =>` - an arrow cannot follow `|`/`&`
    (if (i32.eq (local.get $next) (enum.get $Lex.function_arrow))
      (then
        (if (i32.eqz (call $tsArrowReturnType (local.get $prev) (local.get $lhs)))
          (then (return (enum.get $Token.variable.parameter))))))
    (if
      (i32.and
        (i32.eq (local.get $prev) (enum.get $Lex.l_paren))
        (i32.eq (local.get $next) (enum.get $Lex.r_paren)))
      (then
        (if (call $sigArrowAhead)
          (then (return (enum.get $Token.variable.parameter))))))
    (if (i32.and (i32.eq (local.get $next) (enum.get $Lex.ctxword_is)) (call $ecmaHasTypeScript))
      (then (return (enum.get $Token.variable.parameter))))
    (if (call $sigActive)
      (then
        (if
          (i32.and
            (i32.eqz (i32.or (global.get $sigObscure) (global.get $sigAngle)))
            ;; normalized: bitset.get returns the masked byte, not 0/1
            (i32.ne (bitset.get $LexBits.sigParamPrev (local.get $prev)) (i32.const 0)))
          (then (return (enum.get $Token.variable.parameter))))
        (if
          (i32.and
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
    (if (i32.and (i32.eq (local.get $prev) (enum.get $Lex.l_paren)) (call $ecmaHasTypeScript))
      (then
        (if
          (i32.or
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
    (if (i32.and (i32.eq (local.get $prev) (enum.get $Lex.colon)) (call $ecmaHasTypeScript))
      (then
        (if (call $isPredefinedType (local.get $lhs) (local.get $rhs))
          (then (return (enum.get $Token.type.builtin))))))
    ;; `new C` - but in `new ns.C` the namespace is an ordinary name (a `.`
    ;; on the next line has not arrived yet in a line-fed chunk)
    (if (i32.eq (local.get $prev) (enum.get $Lex.keyword_new))
      (then
        (if (i32.or (i32.ne (local.get $next) (enum.get $Lex.dot)) (global.get $nlBefore))
          (then (return (enum.get $Token.type.class))))))
    ;; declared type names, before the SCREAMING_CASE constant rule can fire:
    ;; class/extends heads are Zed's type.class, interface/enum/type names type
    (if
      (i32.or
        (i32.eq (local.get $prev) (enum.get $Lex.keyword_class))
        (i32.eq (local.get $prev) (enum.get $Lex.keyword_extends)))
      (then (return (enum.get $Token.type.class))))
    (if
      (i32.or
        (i32.or
          (i32.eq (local.get $prev) (enum.get $Lex.keyword_interface))
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
    (if
      (i32.and
        (i32.or
          (i32.or
            (i32.eq (local.get $prev) (enum.get $Lex.l_brace))
            (i32.eq (local.get $prev) (enum.get $Lex.comma)))
          (i32.and (call $ecmaHasTypeScript) (i32.eq (local.get $prev) (enum.get $Lex.semicolon))))
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
    ;; unless they sit in a TS type position, and other Uppercase-initial
    ;; names are types, deliberately
    (if (call $isConstCase (local.get $lhs) (local.get $rhs))
      (then
        (if (call $ecmaHasTypeScript)
          (then
            (if (call $tsTypeSlot (local.get $prev) (local.get $next) (local.get $lhs))
              (then (return (enum.get $Token.type))))))
        (return (enum.get $Token.constant))))
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
  (func $classify
    (param $prev i32)
    (param $t i32)
    (param $next i32)
    (param $lhs i32)
    (param $rhs i32)
    (result i32)
    (local $hl i32)
    (call $sigStep
      (local.get $prev)
      (local.get $t)
      (local.get $next)
      (local.get $lhs)
      (local.get $rhs))
    (local.set $hl (enum-map.get $LexHl (local.get $t)))
    (if (i32.lt_u (local.get $hl) (i32.const 254))
      (then (return (local.get $hl))))
    (if (i32.eq (local.get $hl) (i32.const 255))
      (then
        (return
          (call $identHl
            (local.get $prev)
            (local.get $t)
            (local.get $next)
            (local.get $lhs)
            (local.get $rhs)))))
    ;; `:` before a type name and `?` directly before `:` are TypeScript
    ;; punctuation.special; the word compare only runs for a colon before an
    ;; identifier - wasm i32.and is eager, and this runs for every such token
    (if (call $ecmaHasTypeScript)
      (then
        (if (i32.eq (local.get $t) (enum.get $Lex.colon))
          (then
            (if (i32.eq (local.get $next) (enum.get $Lex.identifier))
              (then
                (if
                  (i32.or
                    (i32.le_u
                      (i32.sub (call $tsxByte (global.get $lhs)) (i32.const "A"))
                      (i32.const 25))
                    (call $isPredefinedType (global.get $lhs) (global.get $rhs)))
                  (then (return (enum.get $Token.punctuation.special)))))))
          (else
            (if (i32.eq (local.get $next) (enum.get $Lex.colon))
              (then (return (enum.get $Token.punctuation.special))))))))
    ;; otherwise `:` is a delimiter and `?` a ternary operator
    (select
      (enum.get $Token.punctuation.delimiter)
      (enum.get $Token.operator)
      (i32.eq (local.get $t) (enum.get $Lex.colon))))

  (func $hlTs
    (call $hlEcma (i32.const 1)))
  (func $hlTsStream (param $reset i32)
    (call $hlEcmaStream (i32.const 1) (local.get $reset)))
)
