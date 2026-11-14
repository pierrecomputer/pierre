(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (memory-region $mem.surrealqlWords 480)

  (import "@pierre/wat-tools/common.wat")

  ;; Matched without case. Bit 256: the next name is a table, 512: the next
  ;; name is a field.
  (keyword-table $surrealqlWords $mem.surrealqlWords $mem.surrealqlWords+480
    (group $Token.keyword+256 "from" "into" "on" "table" "only" "create" "update" "delete" "upsert")
    (group $Token.keyword+512 "field" "fields")
    (group $Token.keyword
      "select" "let" "insert" "remove" "live" "use" "begin" "commit" "cancel"
      "sleep" "kill" "show" "where" "set" "unset" "merge" "patch" "replace" "fetch"
      "split" "group" "by" "order" "limit" "start" "timeout" "parallel" "type" "assert"
      "schemafull" "schemaless" "permissions" "index" "event" "namespace" "ns" "db"
      "function" "param" "analyzer" "user" "access" "value" "values" "unique" "search" "explain"
      "with" "noindex" "at" "as" "asc" "desc" "collate" "numeric" "omit" "transaction"
      "changefeed" "comment" "default" "readonly" "flexible" "relation" "overwrite" "ignore"
      "exists" "full" "diff" "before" "after" "when" "drop" "all" "tempfiles")
    (group $Token.keyword.control "if" "else" "then" "end" "for" "break" "continue" "throw" "return")
    (group $Token.keyword.operator
      "and" "or" "not" "is" "contains" "containsnot" "containsall" "containsany" "containsnone"
      "inside" "notinside" "allinside" "anyinside" "noneinside" "outside" "intersects" "in")
    (group $Token.type.builtin
      "any" "array" "bool" "bytes" "datetime" "decimal" "duration" "float" "geometry" "int"
      "number" "object" "option" "record" "string" "uuid" "future")
    (group $Token.constant.builtin "none" "null")
    (group $Token.boolean "true" "false"))

  ;; $expect is 1 where a table name may follow (after `FROM`, `->`), 2
  ;; where a field name may follow, and 3 after a table name, where `,`
  ;; starts another. $cast counts the open `<` of a cast such
  ;; as `<array<int>>`. Both are checkpointed.
  (func $hlSurrealql
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $g i32)
    (local $hl i32)
    (local $was i32)
    (local $expect i32)
    (local $cast i32)
    (local $w i64)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $lhs (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (local.set $was (local.get $expect))
        (local.set $expect (i32.const 0))

        ;; comments keep a pending table or field name
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const "#"))
            (i32.and
              (i32.or (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c) (i32.const "/")))
              (i32.eq (local.get $c2) (local.get $c))))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (local.set $expect (local.get $was))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (local.set $expect (local.get $was))
            (br $next)))
        ;; strings may span lines; `d"..."`, `r"..."`, `u"..."` are typed literals
        (local.set $hl (enum.get $Token.string))
        (if
          (i32.and
            (byteset.get "bdrsu" (local.get $c))
            (i32.or (i32.eq (local.get $c2) (i32.const 34)) (i32.eq (local.get $c2) (i32.const 39))))
          (then
            (local.set $hl (enum.get $Token.string.special))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (local.set $c (local.get $c2))))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $lexString (local.get $c) (i32.const 1) (local.get $hl))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "$")) (call $lexIsIdentContinue (local.get $c2)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; the identifier run takes duration units and suffixes: `1h30m`, `10dec`
        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "`"))
          (then
            (global.set $ptr
              (call $scanFindSpecial
                (i32.add (local.get $lhs) (i32.const 1))
                (global.get $end)
                (i32.const "`")
                (i32.const 0)
                (i32.const 1)))
            (global.set $ptr
              (i32.add (global.get $ptr) (i32.eq (call $templateByte (global.get $ptr)) (i32.const "`"))))
            (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (call $lexIsNameStart (local.get $c))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $rhs (global.get $ptr))
            (local.set $c2 (call $templateByte (local.get $rhs)))
            (local.set $g (call $templateByte (i32.add (local.get $rhs) (i32.const 1))))
            (block $classified
              ;; `time::now`, `fn::custom`
              (local.set $hl (enum.get $Token.function))
              (local.set $p (local.get $rhs))
              (block $path
                (loop $segment
                  (br_if $path (i32.ne (call $templateByte (global.get $ptr)) (i32.const ":")))
                  (br_if $path
                    (i32.ne (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const ":")))
                  (br_if $path
                    (i32.eqz
                      (call $lexIsNameStart (call $templateByte (i32.add (global.get $ptr) (i32.const 2))))))
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                  (call $scanIdentRun (i32.const "_"))
                  (local.set $rhs (global.get $ptr))
                  (br $segment)))
              (br_if $classified (i32.ne (local.get $p) (local.get $rhs)))
              ;; record ids such as `person:[1, 2]`: `[` ORed with 32 is `{`
              (block $key
              (if
                (i32.and
                  (i32.eq (local.get $c2) (i32.const ":"))
                  (i32.or
                    (call $lexIsIdentContinue (local.get $g))
                    (i32.or
                      (i32.eq (local.get $g) (i32.const "`"))
                      (i32.eq (i32.or (local.get $g) (i32.const 32)) (i32.const "{")))))
                (then
                  (br_if $key
                    (i32.and
                      (i32.gt_u (local.get $lhs) (global.get $srcBase))
                      (i32.eq (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))) (i32.const "{"))))
                  (call $emitTok (enum.get $Token.type) (local.get $lhs) (local.get $rhs))
                  (local.set $lhs (i32.add (local.get $rhs) (i32.const 1)))
                  (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $rhs) (local.get $lhs))
                  (global.set $ptr (local.get $lhs))
                  (if (i32.eq (local.get $g) (i32.const "`"))
                    (then
                      (global.set $ptr
                        (call $scanFindSpecial
                          (i32.add (local.get $lhs) (i32.const 1))
                          (global.get $end)
                          (i32.const "`")
                          (i32.const 0)
                          (i32.const 1)))
                      (global.set $ptr
                        (i32.add
                          (global.get $ptr)
                          (i32.eq (call $templateByte (global.get $ptr)) (i32.const "`"))))))
                  (if
                    (i32.and
                      (i32.le_u (i32.add (local.get $lhs) (i32.const 3)) (global.get $end))
                      (i32.eq
                        (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff))
                        (i32.const 0xa89fe2)))
                    (then
                      ;; `⟨` to `⟩` on this line
                      (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))
                      (block $closed
                        (loop $id
                          (br_if $closed (i32.ge_u (global.get $ptr) (global.get $end)))
                          (local.set $p (i32.load8_u (global.get $ptr)))
                          (br_if $closed (byteset.get "\n\r" (local.get $p)))
                          (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                          (br_if $id (i32.ne (local.get $p) (i32.const 0xe2)))
                          (br_if $id
                            (i32.ne
                              (i32.and (i32.load (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 0xffffff))
                              (i32.const 0xa99fe2)))
                          (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))))))
                  (if (i32.eq (global.get $ptr) (local.get $lhs))
                    (then (call $scanIdentRun (i32.const "_"))))
                  (local.set $rhs (global.get $ptr))
                  (local.set $hl
                    (select
                      (enum.get $Token.function)
                      (enum.get $Token.constant)
                      (i32.eq (call $templateByte (local.get $rhs)) (i32.const "("))))
                  (br $classified))))
              (local.set $hl (enum.get $Token.type.builtin))
              (br_if $classified (local.get $cast))
              ;; `user.name`, `{ name: value }`
              (local.set $hl (enum.get $Token.property))
              (br_if $classified
                (i32.and
                  (i32.gt_u (local.get $lhs) (global.get $srcBase))
                  (i32.eq (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))) (i32.const "."))))
              (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
              (br_if $classified
                (i32.and
                  (i32.eq (call $templateByte (local.get $p)) (i32.const ":"))
                  (i32.ne (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const ":"))))
              (br_if $classified (i32.eq (local.get $was) (i32.const 2)))
              (local.set $g
                (i32.add
                  (keyword-table.value $surrealqlWords
                    (i32.const $mem.lexLowerScratch)
                    (i32.add
                      (i32.const $mem.lexLowerScratch)
                      (call $lexLowerCopy (local.get $lhs) (local.get $rhs) (i32.const $mem.lexLowerScratch))))
                  (i32.const 1)))
              ;; these share a table hash with `delete`, `remove`, `comment`, and `datetime`
              (if (i32.and (i32.eqz (local.get $g)) (i32.le_u (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 8)))
                (then
                  (local.set $w
                    (i64.and
                      (i64.load (i32.const $mem.lexLowerScratch))
                      (i64.shr_u
                        (i64.const -1)
                        (i64.extend_i32_u
                          (i32.shl (i32.sub (i32.const 8) (i32.sub (local.get $rhs) (local.get $lhs))) (i32.const 3))))))
                  (if
                    (i32.or
                      (i32.or (i64.eq (local.get $w) (i64.const "define")) (i64.eq (local.get $w) (i64.const "content")))
                      (i64.eq (local.get $w) (i64.const "database")))
                    (then (local.set $g (i32.add (enum.get $Token.keyword) (i32.const 1)))))
                  (if (i64.eq (local.get $w) (i64.const "relate"))
                    (then (local.set $g (i32.add (enum.get $Token.keyword) (i32.const 257)))))))
              ;; after `FROM` or `->` a table may share a keyword's name, but
              ;; `ON TABLE user`, `CREATE ONLY person`, and uppercase words
              ;; such as `UPDATE WHERE` keep their keywords
              (local.set $hl (enum.get $Token.type))
              (if
                (i32.and
                  (i32.and
                    (i32.eq (local.get $was) (i32.const 1))
                    (i32.lt_u (local.get $g) (i32.const 257)))
                  (i32.eqz
                    (i32.and
                      (i32.ne (local.get $g) (i32.const 0))
                      (i32.and
                        (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                        (i32.le_u (i32.sub (i32.load8_u offset=1 (local.get $lhs)) (i32.const "A")) (i32.const 25))))))
                (then
                  (local.set $expect (i32.const 3))
                  (br $classified)))
              (if (local.get $g)
                (then
                  (local.set $hl (enum.get $Token.variable))
                  (br_if $classified (i32.eq (call $templateByte (local.get $p)) (i32.const "=")))
                  (local.set $g (i32.sub (local.get $g) (i32.const 1)))
                  (local.set $hl (i32.and (local.get $g) (i32.const 255)))
                  (local.set $expect (i32.shr_u (local.get $g) (i32.const 8)))
                  (br $classified)))
              (local.set $hl
                (select
                  (enum.get $Token.function)
                  (enum.get $Token.variable)
                  (i32.eq (call $templateByte (local.get $p)) (i32.const "(")))))
            (global.set $ptr (local.get $rhs))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        ;; casts: `<int>`, `<array<string>>`, `<future>`
        (if (i32.and (i32.eq (local.get $c) (i32.const "<")) (call $lexIsNameStart (local.get $c2)))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $p (call $templateByte (global.get $ptr)))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (if (i32.or (i32.eq (local.get $p) (i32.const "<")) (i32.eq (local.get $p) (i32.const ">")))
              (then
                (local.set $cast (i32.add (local.get $cast) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                (br $next)))))
        (if (i32.and (i32.eq (local.get $c) (i32.const ">")) (i32.ne (local.get $cast) (i32.const 0)))
          (then
            (local.set $cast (i32.sub (local.get $cast) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c2) (i32.const ".")))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get ",.:;" (local.get $c))
          (then
            (if (i32.eq (local.get $c) (i32.const ";"))
              (then (local.set $cast (i32.const 0))))
            ;; `FROM user, event`
            (if (i32.and (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $was) (i32.const 3)))
              (then (local.set $expect (i32.const 1))))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get "!%&*+-/<=>?^|~" (local.get $c))
          (then
            ;; graph edges: `->`, `<-`, `<->`; a table name follows
            (if
              (i32.or
                (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c2) (i32.const ">")))
                (i32.and (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c2) (i32.const "-"))))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (global.set $ptr
                  (i32.add
                    (global.get $ptr)
                    (i32.and
                      (i32.eq (local.get $c) (i32.const "<"))
                      (i32.eq (call $templateByte (global.get $ptr)) (i32.const ">")))))
                (local.set $expect (i32.const 1)))
              (else
                ;; `==`, `!=`, `*=`, `?=`, `!~`, `?~`, `&&`, `||`, `??`
                (if
                  (i32.or
                    (i32.or (i32.eq (local.get $c2) (i32.const "=")) (i32.eq (local.get $c2) (i32.const "~")))
                    (i32.and (i32.eq (local.get $c2) (local.get $c)) (byteset.get "&?|" (local.get $c))))
                  (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
