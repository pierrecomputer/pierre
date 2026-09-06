(module
  (import "../common.wat")

  ;; SQL keywords are case-insensitive, so the word is ASCII-folded with
  ;; `| 0x20` instead of being matched byte for byte - which is why this stays a
  ;; compare ladder rather than a keyword table. Every keyword is 2..8 bytes, so
  ;; one i64 load holds the whole candidate: fold it and narrow it to the word's
  ;; own width once, so a packed compare also implies the length. The ladder
  ;; dispatches on the first folded byte - three ranges, then one letter - so
  ;; an ordinary identifier pays a handful of byte compares and at most seven
  ;; wide ones instead of walking every keyword of its length.
  (func $sqlWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    (local $n i32)
    (local $w i64)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.gt_u (i32.sub (local.get $n) (i32.const 2)) (i32.const 6))
      (then (return (enum.get $Token.variable))))
    (local.set $w (i64.and
      (i64.or (i64.load (local.get $lhs)) (i64.const 0x2020202020202020))
      (i64.shr_u (i64.const -1) (i64.extend_i32_u
        (i32.shl (i32.sub (i32.const 8) (local.get $n)) (i32.const 3))))))
    (local.set $c (i32.and (i32.wrap_i64 (local.get $w)) (i32.const 255)))
    (if (i32.lt_u (local.get $c) (i32.const "i"))
      (then
        (if (i32.eq (local.get $c) (i32.const "a"))
          (then
            (if (i32.or
                (i64.eq (local.get $w) (i64.const "all"))
                (i32.or
                  (i64.eq (local.get $w) (i64.const "as"))
                  (i64.eq (local.get $w) (i64.const "asc"))))
              (then (return (enum.get $Token.keyword))))
            (if (i64.eq (local.get $w) (i64.const "and"))
              (then (return (enum.get $Token.keyword.operator))))
            (return (enum.get $Token.variable))))
        (if (i32.eq (local.get $c) (i32.const "b"))
          (then
            (if (i64.eq (local.get $w) (i64.const "by"))
              (then (return (enum.get $Token.keyword))))
            (if (i64.eq (local.get $w) (i64.const "between"))
              (then (return (enum.get $Token.keyword.operator))))
            (if (i32.or
                (i64.eq (local.get $w) (i64.const "bigint"))
                (i32.or
                  (i64.eq (local.get $w) (i64.const "blob"))
                  (i64.eq (local.get $w) (i64.const "boolean"))))
              (then (return (enum.get $Token.type.builtin))))
            (return (enum.get $Token.variable))))
        (if (i32.eq (local.get $c) (i32.const "c"))
          (then
            (if (i64.eq (local.get $w) (i64.const "create"))
              (then (return (enum.get $Token.keyword))))
            (if (i64.eq (local.get $w) (i64.const "case"))
              (then (return (enum.get $Token.keyword.control))))
            (if (i64.eq (local.get $w) (i64.const "char"))
              (then (return (enum.get $Token.type.builtin))))
            (return (enum.get $Token.variable))))
        (if (i32.eq (local.get $c) (i32.const "d"))
          (then
            (if (i32.or
                (i64.eq (local.get $w) (i64.const "default"))
                (i32.or
                  (i64.eq (local.get $w) (i64.const "delete"))
                  (i32.or
                    (i64.eq (local.get $w) (i64.const "desc"))
                    (i64.eq (local.get $w) (i64.const "distinct")))))
              (then (return (enum.get $Token.keyword))))
            (if (i32.or
                (i64.eq (local.get $w) (i64.const "date"))
                (i32.or
                  (i64.eq (local.get $w) (i64.const "decimal"))
                  (i64.eq (local.get $w) (i64.const "double"))))
              (then (return (enum.get $Token.type.builtin))))
            (return (enum.get $Token.variable))))
        (if (i32.eq (local.get $c) (i32.const "e"))
          (then
            (if (i64.eq (local.get $w) (i64.const "end"))
              (then (return (enum.get $Token.keyword))))
            (if (i64.eq (local.get $w) (i64.const "exists"))
              (then (return (enum.get $Token.keyword.operator))))
            (if (i64.eq (local.get $w) (i64.const "else"))
              (then (return (enum.get $Token.keyword.control))))
            (return (enum.get $Token.variable))))
        (if (i32.eq (local.get $c) (i32.const "f"))
          (then
            (if (i32.or
                (i64.eq (local.get $w) (i64.const "foreign"))
                (i32.or
                  (i64.eq (local.get $w) (i64.const "from"))
                  (i64.eq (local.get $w) (i64.const "full"))))
              (then (return (enum.get $Token.keyword))))
            (if (i64.eq (local.get $w) (i64.const "false"))
              (then (return (enum.get $Token.boolean))))
            (return (enum.get $Token.variable))))
        (if (i32.eq (local.get $c) (i32.const "g"))
          (then
            (if (i64.eq (local.get $w) (i64.const "group"))
              (then (return (enum.get $Token.keyword))))
            (return (enum.get $Token.variable))))
        (if (i32.eq (local.get $c) (i32.const "h"))
          (then
            (if (i64.eq (local.get $w) (i64.const "having"))
              (then (return (enum.get $Token.keyword))))
            (return (enum.get $Token.variable))))
        (return (enum.get $Token.variable))))
    (if (i32.lt_u (local.get $c) (i32.const "p"))
      (then
        (if (i32.eq (local.get $c) (i32.const "i"))
          (then
            (if (i32.or
                (i64.eq (local.get $w) (i64.const "inner"))
                (i32.or
                  (i64.eq (local.get $w) (i64.const "insert"))
                  (i64.eq (local.get $w) (i64.const "into"))))
              (then (return (enum.get $Token.keyword))))
            (if (i32.or
                (i64.eq (local.get $w) (i64.const "in"))
                (i64.eq (local.get $w) (i64.const "is")))
              (then (return (enum.get $Token.keyword.operator))))
            (if (i64.eq (local.get $w) (i64.const "integer"))
              (then (return (enum.get $Token.type.builtin))))
            (return (enum.get $Token.variable))))
        (if (i32.eq (local.get $c) (i32.const "j"))
          (then
            (if (i64.eq (local.get $w) (i64.const "join"))
              (then (return (enum.get $Token.keyword))))
            (if (i32.or
                (i64.eq (local.get $w) (i64.const "json"))
                (i64.eq (local.get $w) (i64.const "jsonb")))
              (then (return (enum.get $Token.type.builtin))))
            (return (enum.get $Token.variable))))
        (if (i32.eq (local.get $c) (i32.const "l"))
          (then
            (if (i32.or
                (i64.eq (local.get $w) (i64.const "left"))
                (i64.eq (local.get $w) (i64.const "limit")))
              (then (return (enum.get $Token.keyword))))
            (if (i64.eq (local.get $w) (i64.const "like"))
              (then (return (enum.get $Token.keyword.operator))))
            (return (enum.get $Token.variable))))
        (if (i32.eq (local.get $c) (i32.const "n"))
          (then
            (if (i64.eq (local.get $w) (i64.const "not"))
              (then (return (enum.get $Token.keyword.operator))))
            (if (i64.eq (local.get $w) (i64.const "nchar"))
              (then (return (enum.get $Token.type.builtin))))
            (if (i64.eq (local.get $w) (i64.const "null"))
              (then (return (enum.get $Token.constant.builtin))))
            (return (enum.get $Token.variable))))
        (if (i32.eq (local.get $c) (i32.const "o"))
          (then
            (if (i32.or
                (i64.eq (local.get $w) (i64.const "on"))
                (i32.or
                  (i64.eq (local.get $w) (i64.const "order"))
                  (i64.eq (local.get $w) (i64.const "outer"))))
              (then (return (enum.get $Token.keyword))))
            (if (i64.eq (local.get $w) (i64.const "or"))
              (then (return (enum.get $Token.keyword.operator))))
            (return (enum.get $Token.variable))))
        (return (enum.get $Token.variable))))
    (if (i32.eq (local.get $c) (i32.const "p"))
      (then
        (if (i64.eq (local.get $w) (i64.const "primary"))
          (then (return (enum.get $Token.keyword))))
        (return (enum.get $Token.variable))))
    (if (i32.eq (local.get $c) (i32.const "r"))
      (then
        (if (i64.eq (local.get $w) (i64.const "right"))
          (then (return (enum.get $Token.keyword))))
        (if (i64.eq (local.get $w) (i64.const "real"))
          (then (return (enum.get $Token.type.builtin))))
        (return (enum.get $Token.variable))))
    (if (i32.eq (local.get $c) (i32.const "s"))
      (then
        (if (i32.or
            (i64.eq (local.get $w) (i64.const "select"))
            (i64.eq (local.get $w) (i64.const "set")))
          (then (return (enum.get $Token.keyword))))
        (return (enum.get $Token.variable))))
    (if (i32.eq (local.get $c) (i32.const "t"))
      (then
        (if (i32.or
            (i64.eq (local.get $w) (i64.const "table"))
            (i64.eq (local.get $w) (i64.const "to")))
          (then (return (enum.get $Token.keyword))))
        (if (i64.eq (local.get $w) (i64.const "then"))
          (then (return (enum.get $Token.keyword.control))))
        (if (i64.eq (local.get $w) (i64.const "text"))
          (then (return (enum.get $Token.type.builtin))))
        (if (i64.eq (local.get $w) (i64.const "true"))
          (then (return (enum.get $Token.boolean))))
        (return (enum.get $Token.variable))))
    (if (i32.eq (local.get $c) (i32.const "u"))
      (then
        (if (i32.or
            (i64.eq (local.get $w) (i64.const "union"))
            (i32.or
              (i64.eq (local.get $w) (i64.const "update"))
              (i64.eq (local.get $w) (i64.const "using"))))
          (then (return (enum.get $Token.keyword))))
        (if (i64.eq (local.get $w) (i64.const "uuid"))
          (then (return (enum.get $Token.type.builtin))))
        (return (enum.get $Token.variable))))
    (if (i32.eq (local.get $c) (i32.const "v"))
      (then
        (if (i64.eq (local.get $w) (i64.const "values"))
          (then (return (enum.get $Token.keyword))))
        (if (i64.eq (local.get $w) (i64.const "varchar"))
          (then (return (enum.get $Token.type.builtin))))
        (return (enum.get $Token.variable))))
    (if (i32.eq (local.get $c) (i32.const "w"))
      (then
        (if (i32.or
            (i64.eq (local.get $w) (i64.const "where"))
            (i64.eq (local.get $w) (i64.const "with")))
          (then (return (enum.get $Token.keyword))))
        (if (i64.eq (local.get $w) (i64.const "when"))
          (then (return (enum.get $Token.keyword.control))))
        (return (enum.get $Token.variable))))
    (enum.get $Token.variable))

  (func $sqlDollarString (result i32)
    (local $candidate i32)
    (local $delimiter i32)
    (local $i i32)
    (local $lhs i32)
    (local $mask i64)
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
    ;; width mask for the packed compare below; only read when $n is 8 or less
    (local.set $mask (i64.shr_u (i64.const -1) (i64.extend_i32_u
      (i32.shl (i32.sub (i32.const 8) (local.get $n)) (i32.const 3)))))
    (global.set $ptr (local.get $delimiter))
    (block $done
      (loop $search
        (local.set $candidate (call $lexFindByte (global.get $ptr) (i32.const "$")))
        ;; A tag that no longer fits before $end cannot fit at any later
        ;; candidate either - candidates only move forward - so the first short
        ;; one ends the search unterminated. This is also the miss case, where
        ;; $lexFindByte returned $end itself.
        (if (i32.gt_u
              (i32.add (local.get $candidate) (local.get $n)) (global.get $end))
          (then
            (local.set $matched (i32.const 0))
            (global.set $ptr (global.get $end))
            (br $done)))
        (local.set $matched (i32.const 1))
        (if (i32.le_u (local.get $n) (i32.const 8))
          (then
            (local.set $matched (i64.eq
              (i64.and (i64.load (local.get $lhs)) (local.get $mask))
              (i64.and (i64.load (local.get $candidate)) (local.get $mask)))))
          (else
            (local.set $i (i32.const 0))
            (block $compareDone
              (loop $compare
                (br_if $compareDone (i32.ge_u (local.get $i) (local.get $n)))
                (if (i32.ne
                      (i32.load8_u (i32.add (local.get $lhs) (local.get $i)))
                      (i32.load8_u (i32.add (local.get $candidate) (local.get $i))))
                  (then
                    (local.set $matched (i32.const 0))
                    (br $compareDone)))
                (local.set $i (i32.add (local.get $i) (i32.const 1)))
                (br $compare)))))
        (if (local.get $matched)
          (then
            (global.set $ptr (i32.add (local.get $candidate) (local.get $n)))
            (br $done)))
        (global.set $ptr (i32.add (local.get $candidate) (i32.const 1)))
        (br $search)))
    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
    (if (i32.eqz (local.get $matched))
      (then (call $streamSetFixed
        (local.get $lhs) (local.get $n) (enum.get $Token.string))))
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
        (call $scanWhitespace)
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
            ;; SQL has no backslash escapes: a doubled quote is the escape, so
            ;; `'It''s'` lexes as a close and a reopen that merge into one
            ;; string span, and `'C:\'` ends at its closing quote. Multiline,
            ;; so a body left open at a chunk end resumes as common mode 3.
            (call $lexRawString (local.get $c) (i32.const 1) (enum.get $Token.string))
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
                (byteset.get "!%&*/^|~" (local.get $c))))
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
