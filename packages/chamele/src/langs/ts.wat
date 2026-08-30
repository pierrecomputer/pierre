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
    (if (call $isBuiltinConst (local.get $lhs) (local.get $rhs))
      (then (return (enum.get $Token.constant.builtin))))
    (if (i32.and
          (call $ecmaHasTypeScript)
          (i32.and
            (i32.eq (local.get $prev) (enum.get $Lex.colon))
            (call $isPredefinedType (local.get $lhs) (local.get $rhs))))
      (then (return (enum.get $Token.type.builtin))))
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
    (if (i32.and
          (call $ecmaHasTypeScript)
          (i32.and
            (i32.eq (local.get $t) (enum.get $Lex.colon))
            (i32.and
              (i32.eq (local.get $next) (enum.get $Lex.identifier))
              (i32.or
                (call $isPredefinedType (global.get $lhs) (global.get $rhs))
                (i32.le_u
                  (i32.sub (call $tsxByte (global.get $lhs)) (i32.const "A"))
                  (i32.const 25))))))
      (then (return (enum.get $Token.punctuation.special))))
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
