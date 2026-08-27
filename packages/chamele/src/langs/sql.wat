(module
  (import "../common.wat")

  (func $sqlWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local $w i64)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (local.set $w (i64.or (i64.load (local.get $lhs)) (i64.const 0x2020202020202020)))
    (if (i32.eq (local.get $n) (i32.const 2))
      (then
        (if (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffff)) (i64.const "in"))
              (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffff)) (i64.const "is"))
                (i64.eq (i64.and (local.get $w) (i64.const 0xffff)) (i64.const "or"))))
          (then (return (enum.get $Token.keyword.operator))))
        (if (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffff)) (i64.const "as"))
              (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffff)) (i64.const "by"))
                (i32.or
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffff)) (i64.const "on"))
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffff)) (i64.const "to")))))
          (then (return (enum.get $Token.keyword))))))
    (if (i32.eq (local.get $n) (i32.const 3))
      (then
        (if (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "and"))
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "not")))
          (then (return (enum.get $Token.keyword.operator))))
        (if (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "all"))
              (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "asc"))
                (i32.or
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "end"))
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "set")))))
          (then (return (enum.get $Token.keyword))))))
    (if (i32.eq (local.get $n) (i32.const 4))
      (then
        (if (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "true"))
          (then (return (enum.get $Token.boolean))))
        (if (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "null"))
          (then (return (enum.get $Token.constant.builtin))))
        (if (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "like"))
          (then (return (enum.get $Token.keyword.operator))))
        (if (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "case"))
              (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "else"))
                (i32.or
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "then"))
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "when")))))
          (then (return (enum.get $Token.keyword.control))))
        (if (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "from"))
              (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "full"))
                (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "into"))
                (i32.or
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "join"))
                  (i32.or
                    (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "left"))
                    (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "with")))))))
          (then (return (enum.get $Token.keyword))))
        (if (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "date"))
              (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "blob"))
                (i32.or
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "char"))
                  (i32.or
                    (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "json"))
                    (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "real"))
                (i32.or
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "text"))
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "uuid"))))))))
          (then (return (enum.get $Token.type.builtin))))))
    (if (i32.eq (local.get $n) (i32.const 5))
      (then
        (if (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "false"))
          (then (return (enum.get $Token.boolean))))
        (if (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "group"))
              (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "limit"))
                (i32.or
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "order"))
                  (i32.or
                      (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "table"))
                      (i32.or
                        (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "outer"))
                        (i32.or
                          (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "right"))
                          (i32.or
                      (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "union"))
                      (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "where")))))))))
          (then (return (enum.get $Token.keyword))))
        (if (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "jsonb"))
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "nchar")))
          (then (return (enum.get $Token.type.builtin))))))
    (if (i32.eq (local.get $n) (i32.const 6))
      (then
        (if (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "create"))
              (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "delete"))
                (i32.or
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "insert"))
                  (i32.or
                    (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "select"))
                    (i32.or
                      (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "update"))
                      (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "values")))))))
          (then (return (enum.get $Token.keyword))))
        (if (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "bigint"))
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "double")))
          (then (return (enum.get $Token.type.builtin))))))
    (if (i32.eq (local.get $n) (i32.const 7))
      (then
        (if (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffffff)) (i64.const "between"))
          (then (return (enum.get $Token.keyword.operator))))
        (if (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffffff)) (i64.const "default"))
              (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffffff)) (i64.const "foreign"))
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffffff)) (i64.const "primary"))))
          (then (return (enum.get $Token.keyword))))
        (if (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffffff)) (i64.const "boolean"))
              (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffffff)) (i64.const "decimal"))
                (i32.or
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffffff)) (i64.const "integer"))
                  (i32.or
                    (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffffff)) (i64.const "numeric"))
                    (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffffff)) (i64.const "varchar"))))))
          (then (return (enum.get $Token.type.builtin))))))
    (if (i32.and (i32.eq (local.get $n) (i32.const 8))
                 (i64.eq (local.get $w) (i64.const "distinct")))
      (then (return (enum.get $Token.keyword))))
    (enum.get $Token.variable))

  ;; SQL has no backslash escapes: a doubled quote is the escape. `'C:\'` ends
  ;; at its closing quote, and `'It''s'` stays a single string token.
  (func $sqlString (param $quote i32)
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (block $done
      (loop $l
        (global.set $ptr (call $scanFindSpecial
          (global.get $ptr) (global.get $end) (local.get $quote)
          (i32.const 0) (i32.const 0)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (br_if $done (i32.ne (i32.load8_u (global.get $ptr)) (local.get $quote)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l)))
    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr)))

  (func $sqlDollarString (result i32)
    (local $candidate i32)
    (local $delimiter i32)
    (local $i i32)
    (local $lhs i32)
    (local $matched i32)
    (local $n i32)
    (local $p i32)
    (local.set $lhs (global.get $ptr))
    (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
    (if (i32.ge_u (local.get $p) (global.get $end))
      (then (return (i32.const 0))))
    (if (i32.and
          (i32.ne (i32.load8_u (local.get $p)) (i32.const "$"))
          (i32.eqz (call $lexIsIdentStart (i32.load8_u (local.get $p)))))
      (then (return (i32.const 0))))
    (block $tagDone
      (loop $tag
        (br_if $tagDone (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $tagDone (i32.eq (i32.load8_u (local.get $p)) (i32.const "$")))
        (if (i32.eqz (call $lexIsIdentContinue (i32.load8_u (local.get $p))))
          (then (return (i32.const 0))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $tag)))
    (if (i32.or
          (i32.ge_u (local.get $p) (global.get $end))
          (i32.ne (i32.load8_u (local.get $p)) (i32.const "$")))
      (then (return (i32.const 0))))
    (local.set $delimiter (i32.add (local.get $p) (i32.const 1)))
    (local.set $n (i32.sub (local.get $delimiter) (local.get $lhs)))
    (global.set $ptr (local.get $delimiter))
    (block $done
      (loop $search
        (local.set $candidate
          (call $lexFindEither (global.get $ptr) (i32.const "$") (i32.const "$")))
        (if (i32.ge_u (local.get $candidate) (global.get $end))
          (then
            (global.set $ptr (global.get $end))
            (br $done)))
        (local.set $matched
          (i32.le_u (local.get $n) (i32.sub (global.get $end) (local.get $candidate))))
        (local.set $i (i32.const 0))
        (block $compareDone
          (loop $compare
            (br_if $compareDone (i32.eqz (local.get $matched)))
            (br_if $compareDone (i32.ge_u (local.get $i) (local.get $n)))
            (if (i32.ne
                  (i32.load8_u (i32.add (local.get $lhs) (local.get $i)))
                  (i32.load8_u (i32.add (local.get $candidate) (local.get $i))))
              (then
                (local.set $matched (i32.const 0))
                (br $compareDone)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $compare)))
        (if (local.get $matched)
          (then
            (global.set $ptr (i32.add (local.get $candidate) (local.get $n)))
            (br $done)))
        (global.set $ptr (i32.add (local.get $candidate) (i32.const 1)))
        (br $search)))
    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
    (i32.const 1))

  (func $hlSql
    (local $c i32)
    (local $hl i32)
    (local $lhs i32)
    (local $next i32)
    (local $p i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $token
        (local.set $lhs (global.get $ptr))
        (call $lexScanWhitespace)
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $next (select
          (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))

        (if (i32.or
              (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $next) (i32.const "-")))
              (i32.eq (local.get $c) (i32.const "#")))
          (then
            (call $lexLineComment (select (i32.const 2) (i32.const 1)
              (i32.eq (local.get $c) (i32.const "-"))) (enum.get $Token.comment))
            (br $token)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/"))
                     (i32.eq (local.get $next) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $token)))

        (if (i32.or
              (i32.eq (local.get $c) (i32.const 34))
              (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $sqlString (local.get $c))
            (br $token)))
        (if (i32.eq (local.get $c) (i32.const "`"))
          (then
            (call $lexRawString (local.get $c) (i32.const 1) (enum.get $Token.string))
            (br $token)))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (if (call $sqlDollarString)
              (then (br $token)))))

        (if (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and
                (i32.eq (local.get $c) (i32.const "."))
                (call $lexIsDigit (local.get $next))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $token)))
        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $hl (call $sqlWordHl (local.get $lhs) (global.get $ptr)))
            (if (i32.eq (local.get $hl) (enum.get $Token.variable))
              (then
                (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                (if (i32.and (i32.lt_u (local.get $p) (global.get $end))
                             (i32.eq (i32.load8_u (local.get $p)) (i32.const "(")))
                  (then (local.set $hl (enum.get $Token.function))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $token)))

        (if (i32.or
              (i32.eq (local.get $c) (i32.const "?"))
              (i32.or
                (i32.eq (local.get $c) (i32.const "$"))
                (i32.or (i32.eq (local.get $c) (i32.const ":"))
                        (i32.eq (local.get $c) (i32.const "@")))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
            (br $token)))
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "("))
                      (i32.eq (local.get $c) (i32.const ")")))
              (i32.or (i32.eq (local.get $c) (i32.const "["))
                      (i32.eq (local.get $c) (i32.const "]"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $token)))
        (if (i32.or
              (i32.eq (local.get $c) (i32.const ","))
              (i32.or (i32.eq (local.get $c) (i32.const ";"))
                      (i32.eq (local.get $c) (i32.const "."))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $token)))
        (if (i32.or
              (i32.le_u (i32.sub (local.get $c) (i32.const "<")) (i32.const 2))
              (i32.or
                (i32.le_u (i32.sub (local.get $c) (i32.const "+")) (i32.const 3))
                (i32.or
                  (i32.or (i32.eq (local.get $c) (i32.const "%"))
                          (i32.eq (local.get $c) (i32.const "|")))
                  (i32.or
                    (i32.or (i32.eq (local.get $c) (i32.const "*"))
                            (i32.eq (local.get $c) (i32.const "&")))
                    (i32.or
                      (i32.or (i32.eq (local.get $c) (i32.const "^"))
                              (i32.eq (local.get $c) (i32.const "~")))
                      (i32.eq (local.get $c) (i32.const "!")))))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.and (i32.lt_u (global.get $ptr) (global.get $end))
                         (i32.or (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "="))
                                 (i32.eq (i32.load8_u (global.get $ptr)) (local.get $c))))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $token)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $token))))
)
