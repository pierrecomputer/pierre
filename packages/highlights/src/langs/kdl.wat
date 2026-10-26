(module
  (import "../common.wat")
  (import "./groq.wat")
  (import "./rust.wat")

  ;; Advance $ptr over identifier bytes: any byte but blanks, controls, and
  ;; `\/(){};[]="`. Numbers and `#` keywords use the same run.
  (func $kdlIdentEnd
    (local $c i32)
    (block $done
      (loop $l
        (call $scanIdentRun (i32.const "-"))
        (local.set $c (call $templateByte (global.get $ptr)))
        (br_if $done (i32.le_u (local.get $c) (i32.const 32)))
        (br_if $done (byteset.get "\22()/;=[\5c]{}" (local.get $c)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l))))

  ;; The number of `#` at $p when a `"` follows them, or -1.
  (func $kdlRawHashes (param $p i32) (result i32)
    (local $q i32)
    (local.set $q (local.get $p))
    (block $done
      (loop $l
        (br_if $done (i32.ne (call $templateByte (local.get $q)) (i32.const "#")))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $l)))
    (select
      (i32.sub (local.get $q) (local.get $p))
      (i32.const -1)
      (i32.eq (call $templateByte (local.get $q)) (i32.const 34))))

  ;; boolean for `true` and `false`, constant.builtin for `null`, else none
  (func $kdlLiteral (param $lhs i32) (param $rhs i32) (result i32)
    (local $w i32)
    (local.set $w (i32.load (local.get $lhs)))
    (if (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 4))
      (then
        (if (i32.eq (local.get $w) (i32.const "true"))
          (then (return (enum.get $Token.boolean))))
        (if (i32.eq (local.get $w) (i32.const "null"))
          (then (return (enum.get $Token.constant.builtin))))))
    (select
      (enum.get $Token.boolean)
      (enum.get $Token.none)
      (i32.and
        (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 5))
        (i32.and
          (i32.eq (local.get $w) (i32.const "fals"))
          (i32.eq (i32.load8_u offset=4 (local.get $lhs)) (i32.const "e"))))))

  ;; Scan a string body from $ptr to its closing `"`, or `"""` if $triple,
  ;; across lines. Escapes are string.escape in a string, else part of $hl.
  ;; Returns 1 after the closing quote, 0 at $end.
  (func $kdlStringBody (param $triple i32) (param $hl i32) (result i32)
    (local $seg i32)
    (local $e i32)
    (local.set $seg (global.get $ptr))
    (block $open
      (loop $l
        (global.set $ptr
          (call $scanFindSpecial (global.get $ptr) (global.get $end) (i32.const 34) (i32.const 1) (i32.const 0)))
        (br_if $open (i32.ge_u (global.get $ptr) (global.get $end)))
        (if (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 34))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (local.get $triple)
              (then
                (br_if $l
                  (i32.or
                    (i32.ne (call $templateByte (global.get $ptr)) (i32.const 34))
                    (i32.ne (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const 34))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))))
            (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
            (return (i32.const 1))))
        (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
        (local.set $e (call $groqEscapeEnd (global.get $ptr)))
        (call $emitTok
          (select
            (enum.get $Token.string.escape)
            (local.get $hl)
            (i32.eq (local.get $hl) (enum.get $Token.string)))
          (global.get $ptr)
          (local.get $e))
        (global.set $ptr (local.get $e))
        (local.set $seg (local.get $e))
        (br $l)))
    (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
    (i32.const 0))

  ;; KDL v2 and v1 documents.
  ;; $args: 0 at a node name, 1 after it. $paren: inside a `(type)`.
  ;; $join: a `\` continues the node on the next line.
  ;; $open: an unclosed string, 1 `"`, 2 `"""`, or 3 + n raw with n `#`.
  ;; $mute: what a `/-` comments out, 1 the next argument or property, 2 the
  ;; node, 3 a children block, plus 4 per `{` open inside it.
  ;; $after: 1 when the token is a name or value, 2 when it ends $mute.
  (func $hlKdl
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $gap i32)
    (local $p i32)
    (local $hl i32)
    (local $after i32)
    (local $args i32)
    (local $paren i32)
    (local $join i32)
    (local $open i32)
    (local $mute i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $after (i32.const 0))
        (block $emit
          (block $body
            (local.set $lhs (global.get $ptr))
            (br_if $body (local.get $open))
            (local.set $gap (global.get $ptr))
            (call $scanWhitespace)
            (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
              (then
                (local.set $c (i32.const 1))
                ;; `\` joins one line break, so a blank line after it ends the node
                (if (local.get $join)
                  (then
                    (local.set $p (call $lexFindEither (local.get $gap) (i32.const 10) (i32.const 13)))
                    (local.set $p
                      (i32.add
                        (local.get $p)
                        (i32.add
                          (i32.const 1)
                          (i32.and
                            (i32.eq (i32.load8_u (local.get $p)) (i32.const 13))
                            (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const 10))))))
                    (local.set $c (call $lexGapHasBreak (local.get $p) (global.get $ptr)))
                    (local.set $join (i32.const 0))))
                (if (local.get $c)
                  (then
                    (if (i32.and (i32.eq (local.get $mute) (i32.const 2)) (local.get $args))
                      (then (local.set $mute (i32.const 0))))
                    (local.set $args (i32.const 0))
                    (local.set $paren (i32.const 0))))))
            (call $emitGap (local.get $gap) (global.get $ptr))
            (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $lhs (global.get $ptr))
            (local.set $c (i32.load8_u (local.get $lhs)))
            (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (if (i32.eq (local.get $c) (i32.const "/"))
              (then
                (if (i32.eq (local.get $c2) (i32.const "-"))
                  (then
                    (if (i32.eqz (local.get $mute))
                      (then (local.set $mute (i32.sub (i32.const 2) (local.get $args)))))
                    (local.set $hl (enum.get $Token.comment))
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                    (br $emit)))
                (local.set $hl (enum.get $Token.none))
                (br_if $emit
                  (i32.and (i32.ne (local.get $c2) (i32.const "/")) (i32.ne (local.get $c2) (i32.const "*"))))
                (global.set $ptr (local.get $lhs))
                (if (i32.eq (local.get $c2) (i32.const "/"))
                  (then (call $lexLineComment (i32.const 2) (enum.get $Token.comment)))
                  (else (call $lexNestedBlockComment (i32.const "/*") (i32.const "*/") (enum.get $Token.comment))))
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const 34))
              (then
                (local.set $open (i32.const 1))
                (if
                  (i32.and
                    (i32.eq (local.get $c2) (i32.const 34))
                    (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const 34)))
                  (then
                    (local.set $open (i32.const 2))
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))))
                (br $body)))
            ;; raw strings: v2 `#"…"#`, v1 `r"…"` and `r#"…"#`
            (if
              (i32.or
                (i32.eq (local.get $c) (i32.const "#"))
                (i32.and
                  (i32.eq (local.get $c) (i32.const "r"))
                  (i32.or (i32.eq (local.get $c2) (i32.const "#")) (i32.eq (local.get $c2) (i32.const 34)))))
              (then
                (local.set $p (i32.add (local.get $lhs) (i32.eq (local.get $c) (i32.const "r"))))
                (local.set $c2 (call $kdlRawHashes (local.get $p)))
                (if (i32.ge_s (local.get $c2) (i32.const 0))
                  (then
                    (local.set $open (i32.add (local.get $c2) (i32.const 3)))
                    (global.set $ptr (i32.add (local.get $p) (i32.add (local.get $c2) (i32.const 1))))
                    (br $body)))))
            (if (i32.eq (local.get $c) (i32.const "#"))
              (then
                (call $kdlIdentEnd)
                (local.set $hl
                  (select
                    (enum.get $Token.boolean)
                    (enum.get $Token.constant.builtin)
                    (i32.eq
                      (call $kdlLiteral (i32.add (local.get $lhs) (i32.const 1)) (global.get $ptr))
                      (enum.get $Token.boolean))))
                (local.set $after (i32.const 1))
                (br $emit)))
            (if (byteset.get "()" (local.get $c))
              (then
                (local.set $paren (i32.eq (local.get $c) (i32.const "(")))
                (br $emit)))
            (if (i32.eq (local.get $c) (i32.const "{"))
              (then
                (local.set $args (i32.const 0))
                (local.set $paren (i32.const 0))
                (if (local.get $mute)
                  (then
                    (local.set $mute
                      (select
                        (i32.const 7)
                        (i32.add (local.get $mute) (i32.const 4))
                        (i32.eq (local.get $mute) (i32.const 1))))))
                (br $emit)))
            (if (i32.eq (local.get $c) (i32.const "}"))
              (then
                (local.set $args (i32.const 1))
                (local.set $paren (i32.const 0))
                ;; a `}` that closes the parent ends a muted node or argument
                (if (i32.le_u (i32.sub (local.get $mute) (i32.const 1)) (i32.const 1))
                  (then (local.set $mute (i32.const 0))))
                (if (i32.ge_u (local.get $mute) (i32.const 4))
                  (then
                    (local.set $mute (i32.sub (local.get $mute) (i32.const 4)))
                    (local.set $after (i32.shl (i32.eq (local.get $mute) (i32.const 3)) (i32.const 1)))))
                (br $emit)))
            (if (i32.eq (local.get $c) (i32.const ";"))
              (then
                (local.set $args (i32.const 0))
                (local.set $paren (i32.const 0))
                (local.set $hl (enum.get $Token.punctuation.delimiter))
                (local.set $after (i32.shl (i32.eq (local.get $mute) (i32.const 2)) (i32.const 1)))
                (br $emit)))
            (if (i32.eq (local.get $c) (i32.const "="))
              (then
                (local.set $hl (enum.get $Token.operator))
                (br $emit)))
            (if (i32.eq (local.get $c) (i32.const 92))
              (then
                (local.set $join (i32.const 1))
                (local.set $hl (enum.get $Token.punctuation.special))
                (br $emit)))
            (global.set $ptr (local.get $lhs))
            (call $kdlIdentEnd)
            (local.set $hl (enum.get $Token.none))
            ;; a stray `[`, `]`, or control byte
            (if (i32.eq (global.get $ptr) (local.get $lhs))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (br $emit)))
            (local.set $after (i32.const 1))
            (local.set $hl (enum.get $Token.number))
            (br_if $emit
              (i32.or
                (call $lexIsDigit (local.get $c))
                (i32.and (byteset.get "+-" (local.get $c)) (call $lexIsDigit (local.get $c2)))))
            (local.set $hl (enum.get $Token.type))
            (br_if $emit (local.get $paren))
            (local.set $hl (enum.get $Token.tag))
            (br_if $emit (i32.eqz (local.get $args)))
            (local.set $hl (enum.get $Token.attribute))
            (br_if $emit
              (i32.eq (call $templateByte (call $lexSkipSpaceAt (global.get $ptr))) (i32.const "=")))
            ;; v1 keywords; v2 spells them `#true`, `#false`, `#null`
            (local.set $hl (call $kdlLiteral (local.get $lhs) (global.get $ptr)))
            (if (i32.eqz (local.get $hl))
              (then (local.set $hl (enum.get $Token.string))))
            (br $emit))
          ;; a string from its opener at $lhs, or from $ptr when resuming
          (local.set $hl
            (select
              (enum.get $Token.comment)
              (select
                (enum.get $Token.type)
                (select (enum.get $Token.string) (enum.get $Token.tag) (local.get $args))
                (local.get $paren))
              (local.get $mute)))
          (if (i32.lt_u (local.get $open) (i32.const 3))
            (then
              (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
              (local.set $c (call $kdlStringBody (i32.eq (local.get $open) (i32.const 2)) (local.get $hl)))
              (local.set $lhs (global.get $ptr)))
            (else (local.set $c (call $rustRawBody (i32.sub (local.get $open) (i32.const 3))))))
          (if (i32.eqz (local.get $c))
            (then
              (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
              (br $done)))
          (local.set $open (i32.const 0))
          (local.set $after (i32.const 1)))
        (call $emitTok
          (select (enum.get $Token.comment) (local.get $hl) (local.get $mute))
          (local.get $lhs)
          (global.get $ptr))
        (if (i32.eq (local.get $after) (i32.const 2))
          (then (local.set $mute (i32.const 0))))
        ;; a name or value ends a muted argument unless `=` follows it
        (if (i32.and (i32.eq (local.get $after) (i32.const 1)) (i32.eqz (local.get $paren)))
          (then
            (local.set $args (i32.const 1))
            (if
              (i32.and
                (i32.eq (local.get $mute) (i32.const 1))
                (i32.ne (call $templateByte (call $lexSkipSpaceAt (global.get $ptr))) (i32.const "=")))
              (then (local.set $mute (i32.const 0))))))
        (br $next))))
)
