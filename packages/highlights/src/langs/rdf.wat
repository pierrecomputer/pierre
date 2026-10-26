(module
  (import "../common.wat")

  (func $hlSparql
    (call $hlRdfImpl (i32.const 1)))

  (func $hlTurtle
    (call $hlRdfImpl (i32.const 0)))

  ;; The token sits in the low byte. Bit 8 marks the words Turtle (and TriG)
  ;; share with SPARQL; SPARQL matches every word without case.
  (keyword-table $sparqlWords $mem.sparqlWords $mem.cypherWords
    (group $Token.keyword.import+256 "prefix" "base")
    (group $Token.boolean+256 "true" "false")
    (group $Token.keyword+256 "graph")
    (group $Token.keyword
      "select" "construct" "describe" "ask" "where" "from" "named" "distinct" "reduced" "order"
      "by" "group" "having" "limit" "offset" "values" "bind" "filter" "optional" "union" "minus"
      "service" "silent" "insert" "delete" "data" "with" "using" "load" "clear" "drop" "create"
      "add" "move" "copy" "to" "into" "default" "all" "undef" "as" "asc" "desc" "separator")
    (group $Token.keyword.operator "not" "in" "exists"))

  ;; Advance $ptr over one part of a prefixed name: name bytes and `-`, with
  ;; dots only inside. A local part ($local) also takes `:`, `%` hex escapes,
  ;; and `\` escapes such as `ex:a\,b`.
  (func $rdfName (param $local i32)
    (local $c i32)
    (block $done
      (loop $more
        (call $scanIdentRun (i32.const "-"))
        (local.set $c (call $templateByte (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (br_if $done
              (i32.eqz
                (call $lexIsIdentContinue
                  (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $more)))
        (br_if $done (i32.eqz (local.get $local)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $c) (i32.const "%")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $more)))
        (br_if $done (i32.ne (local.get $c) (i32.const 92)))
        (br_if $done
          (i32.le_u (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const 32)))
        (global.set $ptr
          (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 2)) (global.get $end)))
        (br $more))))

  ;; Scan a string body from $ptr to its closing quote $q, three of them when
  ;; $long. [$seg,$ptr) is scanned but not yet emitted. A short string also
  ;; ends at a line break. Return $q while a long string is open at $end.
  (func $rdfString (param $q i32) (param $long i32) (param $seg i32) (result i32)
    (local $c i32)
    (local $e i32)
    (block $done
      (loop $scan
        (global.set $ptr
          (call $scanFindSpecial
            (global.get $ptr)
            (global.get $end)
            (local.get $q)
            (i32.const 1)
            (i32.eqz (local.get $long))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $q))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br_if $scan
              (i32.and
                (local.get $long)
                (i32.or
                  (i32.ne (call $templateByte (global.get $ptr)) (local.get $q))
                  (i32.ne
                    (call $templateByte (i32.add (global.get $ptr) (i32.const 1)))
                    (local.get $q)))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.shl (local.get $long) (i32.const 1))))
            (local.set $long (i32.const 0))
            (br $done)))
        ;; a raw line break: only a short string stops there, unterminated
        (br_if $done (i32.ne (local.get $c) (i32.const 92)))
        (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
        ;; a backslash before a line break stays alone, so the break still
        ;; ends a short string in whole and line-fed runs alike
        (local.set $c (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $e
          (select
            (i32.add (global.get $ptr) (i32.const 1))
            (call $lexCEscapeEnd (global.get $ptr))
            (byteset.get "\n\r" (local.get $c))))
        (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
        (global.set $ptr (local.get $e))
        (local.set $seg (local.get $e))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (select (local.get $q) (i32.const 0) (local.get $long)))

  ;; Turtle, TriG, and SPARQL. $term is the role of the next term: 0 subject,
  ;; 1 predicate, 2 object, 3 after an object or inside an expression, 4 after
  ;; a keyword (until an IRI, `{`, or `.`), 5 a datatype after `^^`. $nest
  ;; holds the roles around open `[` and `(`, three bits per level. $long is
  ;; the quote of a long string open at the chunk end. All three are
  ;; checkpointed.
  (func $hlRdfImpl (param $sparql i32)
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $g i32)
    (local $hl i32)
    (local $term i32)
    (local $nest i32)
    (local $long i32)
    (call $lexEmitLeadingContinuation)
    (if (local.get $long)
      (then
        (local.set $long (call $rdfString (local.get $long) (i32.const 1) (global.get $ptr)))))
    (block $done
      (loop $next
        (local.set $lhs (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (block $isTerm
          (if (i32.eq (local.get $c) (i32.const "#"))
            (then
              (global.set $ptr (local.get $lhs))
              (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
              (br $next)))
          (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
            (then
              (if
                (i32.and
                  (i32.eq (local.get $c2) (local.get $c))
                  (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (local.get $c)))
                (then
                  (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))
                  (local.set $long (call $rdfString (local.get $c) (i32.const 1) (local.get $lhs))))
                (else (drop (call $rdfString (local.get $c) (i32.const 0) (local.get $lhs)))))
              (br $isTerm)))
          ;; an IRI has no blanks and none of `<>"{}|^` and backquote, so
          ;; `?a < ?b` and `?a<?b ||` stay comparisons
          (if (i32.eq (local.get $c) (i32.const "<"))
            (then
              (local.set $p (global.get $ptr))
              (block $iriDone
                (loop $iri
                  (local.set $g (call $templateByte (local.get $p)))
                  (br_if $iriDone (i32.le_u (local.get $g) (i32.const 32)))
                  (br_if $iriDone (byteset.get "<>\22{}|^`" (local.get $g)))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br $iri)))
              (if (i32.eq (local.get $g) (i32.const ">"))
                (then
                  (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                  (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (global.get $ptr))
                  (br_if $isTerm (i32.ne (local.get $term) (i32.const 4)))
                  (local.set $term (i32.const 0))
                  (br $next)))))
          (if
            (i32.and
              (i32.or (i32.eq (local.get $c) (i32.const "?")) (i32.eq (local.get $c) (i32.const "$")))
              (call $lexIsIdentContinue (local.get $c2)))
            (then
              (call $scanIdentRun (i32.const "_"))
              (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
              (br $isTerm)))
          ;; Turtle numbers take a glued sign; SPARQL reads it as an operator
          (local.set $p
            (i32.add
              (local.get $lhs)
              (i32.and (i32.eqz (local.get $sparql)) (byteset.get "+-" (local.get $c)))))
          (local.set $g (call $templateByte (local.get $p)))
          (if
            (i32.or
              (call $lexIsDigit (local.get $g))
              (i32.and
                (i32.eq (local.get $g) (i32.const "."))
                (call $lexIsDigit (call $templateByte (i32.add (local.get $p) (i32.const 1))))))
            (then
              (global.set $ptr (local.get $p))
              (call $lexScanNumber)
              (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
              (br $isTerm)))
          ;; `@prefix` and `@base` are Turtle directives, any other `@name` a
          ;; language tag such as `@en-US`
          (if (i32.eq (local.get $c) (i32.const "@"))
            (then
              (call $scanIdentRun (i32.const "-"))
              (local.set $p (i32.sub (global.get $ptr) (local.get $lhs)))
              (if
                (i32.or
                  (i32.and
                    (i32.eq (local.get $p) (i32.const 7))
                    (i64.eq
                      (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffffffff))
                      (i64.const "@prefix")))
                  (i32.and
                    (i32.eq (local.get $p) (i32.const 5))
                    (i64.eq
                      (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffff))
                      (i64.const "@base"))))
                (then
                  (call $emitTok (enum.get $Token.keyword.import) (local.get $lhs) (global.get $ptr))
                  (local.set $term (i32.const 4)))
                (else
                  (call $emitTok
                    (select (enum.get $Token.attribute) (enum.get $Token.none) (i32.gt_u (local.get $p) (i32.const 1)))
                    (local.get $lhs)
                    (global.get $ptr))))
              (br $next)))
          (if (i32.and (i32.eq (local.get $c) (i32.const "^")) (i32.eq (local.get $c2) (i32.const "^")))
            (then
              (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
              (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
              (local.set $term (i32.const 5))
              (br $next)))

          (if
            (i32.or
              (i32.or
                (i32.ge_u (local.get $c) (i32.const 0x80))
                (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25)))
              (i32.or (i32.eq (local.get $c) (i32.const "_")) (i32.eq (local.get $c) (i32.const ":"))))
            (then
              (global.set $ptr (local.get $lhs))
              (call $rdfName (i32.const 0))
              (local.set $rhs (global.get $ptr))
              (if (i32.eq (call $templateByte (local.get $rhs)) (i32.const ":"))
                (then
                  (global.set $ptr (i32.add (local.get $rhs) (i32.const 1)))
                  (local.set $p (global.get $ptr))
                  (call $rdfName (i32.const 1))
                  ;; `_:name` is a blank node
                  (if
                    (i32.and
                      (i32.eq (local.get $c) (i32.const "_"))
                      (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 1)))
                    (then
                      (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
                      (br $isTerm)))
                  (call $emitTok (enum.get $Token.namespace) (local.get $lhs) (local.get $p))
                  ;; RDF names classes in UpperCamelCase
                  (local.set $hl
                    (select
                      (enum.get $Token.type)
                      (enum.get $Token.constant)
                      (i32.or
                        (i32.eq (local.get $term) (i32.const 5))
                        (i32.le_u (i32.sub (i32.load8_u (local.get $p)) (i32.const "A")) (i32.const 25)))))
                  (if (i32.eq (local.get $term) (i32.const 1))
                    (then (local.set $hl (enum.get $Token.property))))
                  (if
                    (i32.and
                      (local.get $sparql)
                      (i32.eq (call $templateByte (global.get $ptr)) (i32.const "(")))
                    (then (local.set $hl (enum.get $Token.function))))
                  (call $emitTok (local.get $hl) (local.get $p) (global.get $ptr))
                  (br $isTerm)))
              (if
                (i32.and
                  (i32.eq (local.get $c) (i32.const "a"))
                  (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 1)))
                (then
                  (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (local.get $rhs))
                  (br $isTerm)))
              (local.set $g
                (keyword-table.value $sparqlWords
                  (i32.const $mem.lexLowerScratch)
                  (i32.add
                    (i32.const $mem.lexLowerScratch)
                    (call $lexLowerCopy (local.get $lhs) (local.get $rhs) (i32.const $mem.lexLowerScratch)))))
              (if
                (i32.and
                  (i32.ge_s (local.get $g) (i32.const 0))
                  (i32.or (local.get $sparql) (i32.ge_s (local.get $g) (i32.const 256))))
                (then
                  (local.set $hl (i32.and (local.get $g) (i32.const 255)))
                  (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
                  (br_if $isTerm (i32.eq (local.get $hl) (enum.get $Token.boolean)))
                  (local.set $term (i32.const 4))
                  (br $next)))
              ;; other SPARQL words are built-in calls such as `STR(?x)`
              (if
                (i32.and
                  (local.get $sparql)
                  (i32.eq (call $templateByte (call $lexSkipSpaceAt (local.get $rhs))) (i32.const "(")))
                (then
                  (call $emitTok (enum.get $Token.function) (local.get $lhs) (local.get $rhs))
                  (br $isTerm)))
              (call $emitTok (enum.get $Token.none) (local.get $lhs) (local.get $rhs))
              (br $next)))

          (if (byteset.get "()[]{}" (local.get $c))
            (then
              (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
              ;; inside `[` comes a predicate; inside `(` objects, or a path
              ;; when it opens at a predicate
              (if (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "(")))
                (then
                  (local.set $nest (i32.or (i32.shl (local.get $nest) (i32.const 3)) (local.get $term)))
                  (local.set $term
                    (select
                      (i32.const 1)
                      (i32.const 3)
                      (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $term) (i32.const 1)))))
                  (br $next)))
              ;; a closed node or collection is a term of the enclosing role;
              ;; one that a keyword opened, like `FILTER (...)`, ends the clause
              (if (i32.or (i32.eq (local.get $c) (i32.const "]")) (i32.eq (local.get $c) (i32.const ")")))
                (then
                  (local.set $term (i32.and (local.get $nest) (i32.const 7)))
                  (local.set $nest (i32.shr_u (local.get $nest) (i32.const 3)))
                  (br_if $isTerm (i32.ne (local.get $term) (i32.const 4)))))
              (local.set $term (i32.const 0))
              (br $next)))
          (if (byteset.get ".,;:" (local.get $c))
            (then
              (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
              (local.set $term
                (select
                  (i32.const 0)
                  (select (i32.const 1) (i32.const 2) (i32.eq (local.get $c) (i32.const ";")))
                  (i32.eq (local.get $c) (i32.const "."))))
              (br $next)))
          (if (byteset.get "!%&*+-/<=>?^|~" (local.get $c))
            (then
              (if
                (i32.or
                  (i32.eq (local.get $c2) (i32.const "="))
                  (i32.and
                    (i32.eq (local.get $c2) (local.get $c))
                    (i32.or (i32.eq (local.get $c) (i32.const "&")) (i32.eq (local.get $c) (i32.const "|")))))
                (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))))
              (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
              ;; a path step keeps the predicate role: `ex:p/ex:q`, `ex:p|ex:q`
              (if
                (i32.and
                  (i32.eq (local.get $term) (i32.const 2))
                  (i32.and
                    (i32.eq (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1)))
                    (i32.or (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c) (i32.const "|")))))
                (then (local.set $term (i32.const 1))))
              (br $next)))
          (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
          (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
          (br $next))
        (local.set $term
          (select
            (i32.const 4)
            (select (i32.const 3) (i32.add (local.get $term) (i32.const 1)) (i32.ge_u (local.get $term) (i32.const 2)))
            (i32.eq (local.get $term) (i32.const 4))))
        (br $next))))
)
