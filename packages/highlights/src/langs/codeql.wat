(module
  (import "../common.wat")

  ;; Bits 8 and up: the name a declaration keyword expects next, 1 a module,
  ;; 2 a type, 3 a predicate definition.
  (keyword-table $codeqlWords $mem.codeqlWords $mem.sasWords
    (group $Token.keyword.import+256 "import")
    (group $Token.keyword.declaration+256 "module")
    (group $Token.keyword.declaration+512 "class" "newtype")
    (group $Token.keyword.declaration+768 "predicate")
    (group $Token.keyword.declaration "signature")
    (group $Token.keyword.control "from" "where" "select" "exists" "forall" "forex" "if" "then" "else")
    (group $Token.keyword.operator "and" "or" "not" "implies" "instanceof" "in")
    (group $Token.keyword
      "extends" "implements" "as" "order" "by" "asc" "desc" "abstract" "cached" "external"
      "final" "library" "override" "private" "query" "transient" "deprecated" "additional"
      "default" "count" "sum" "min" "max" "avg" "concat" "rank" "strictcount" "strictsum"
      "strictconcat" "unique" "any" "none")
    (group $Token.variable.special "this" "result" "super")
    (group $Token.type.builtin "int" "string" "boolean" "float" "date")
    (group $Token.boolean "true" "false")
    (group $Token.attribute "pragma" "bindingset" "language"))

  ;; $expect names the next name: 1 a module (kept along `a.b.c`), 2 a type,
  ;; 3 a predicate definition, 4 a name after a type, which defines a
  ;; predicate when `(` follows: `string getName()`. It is checkpointed.
  (func $hlCodeql
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $g i32)
    (local $hl i32)
    (local $was i32)
    (local $expect i32)
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

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        ;; `/** ... */` is QLDoc, but `/**/` is empty
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
        (local.set $was (local.get $expect))
        (local.set $expect (i32.const 0))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string))
            (br $next)))
        (if (call $lexIsDigit (local.get $c))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; `@expr`: a database type
        (if (i32.and (i32.eq (local.get $c) (i32.const "@")) (call $lexIsIdentStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (call $emitTok (enum.get $Token.type) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $rhs (global.get $ptr))
            ;; $p and $c2: the two bytes after the name and its blanks
            (local.set $g (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $p (call $templateByte (local.get $g)))
            (local.set $c2 (call $templateByte (i32.add (local.get $g) (i32.const 1))))
            (local.set $g (keyword-table.value $codeqlWords (local.get $lhs) (local.get $rhs)))
            (block $classified
              (if (i32.ge_s (local.get $g) (i32.const 0))
                (then
                  (local.set $hl (i32.and (local.get $g) (i32.const 255)))
                  (local.set $expect (i32.shr_u (local.get $g) (i32.const 8)))
                  (if (i32.eq (local.get $hl) (enum.get $Token.type.builtin))
                    (then (local.set $expect (i32.const 4))))
                  ;; `pragma[inline]` and `bindingset[x, y]` are one annotation
                  (if
                    (i32.and
                      (i32.eq (local.get $hl) (enum.get $Token.attribute))
                      (i32.eq (call $templateByte (local.get $rhs)) (i32.const "[")))
                    (then
                      (local.set $p
                        (call $scanFindSpecial (local.get $rhs) (global.get $end) (i32.const "]") (i32.const 0) (i32.const 1)))
                      (if (i32.eq (call $templateByte (local.get $p)) (i32.const "]"))
                        (then (local.set $rhs (i32.add (local.get $p) (i32.const 1)))))))
                  (br $classified)))
              ;; `DataFlow::Node`
              (local.set $hl (enum.get $Token.namespace))
              (br_if $classified
                (i32.and (i32.eq (local.get $p) (i32.const ":")) (i32.eq (local.get $c2) (i32.const ":"))))
              (if (i32.eq (local.get $was) (i32.const 1))
                (then
                  (local.set $expect (i32.eq (local.get $p) (i32.const ".")))
                  (br $classified)))
              (local.set $hl (enum.get $Token.function.definition))
              (br_if $classified (i32.eq (local.get $was) (i32.const 3)))
              (if
                (i32.or
                  (i32.eq (local.get $was) (i32.const 2))
                  (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))
                (then
                  (local.set $hl (enum.get $Token.type))
                  (local.set $expect (i32.const 4))
                  (br $classified)))
              (if (i32.eq (local.get $p) (i32.const "("))
                (then
                  (br_if $classified (i32.eq (local.get $was) (i32.const 4)))
                  (local.set $hl (enum.get $Token.function))
                  (br $classified)))
              ;; `x.getName()` is a call above; a bare member is a field
              (local.set $hl
                (select
                  (enum.get $Token.property)
                  (enum.get $Token.variable)
                  (i32.and
                    (i32.gt_u (local.get $lhs) (global.get $srcBase))
                    (i32.eq (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))) (i32.const "."))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (global.set $ptr (local.get $rhs))
            (br $next)))

        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c2) (i32.const ".")))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get ".,;:" (local.get $c))
          (then
            (global.set $ptr
              (i32.add
                (global.get $ptr)
                (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $c2) (i32.const ":")))))
            ;; a module path continues through `.` and `::`
            (if (i32.and (i32.eq (local.get $was) (i32.const 1)) (i32.ne (local.get $c) (i32.const ",")))
              (then (local.set $expect (i32.const 1))))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get "!%&*+-/<=>|" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.eq (local.get $c2) (i32.const "="))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
