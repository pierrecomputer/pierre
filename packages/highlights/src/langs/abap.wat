(module
  (import "../common.wat")

  ;; Lowercase words. Bits 8-10 capture the next name: 1 a method or form
  ;; definition, 2 a type, 3 nothing (`CALL METHOD x` calls rather than
  ;; defines), 4 a called form. Bit 11 keeps a pending capture (`TYPE REF TO
  ;; x`), and bit 12 makes the word a builtin type where a type is expected
  ;; (`TYPE REF TO data`). `like`, `where`, and `ascending` collide and are
  ;; matched directly.
  (keyword-table $abapWords $mem.abapWords $mem.moonbitWords
    (group $Token.keyword.declaration
      "constants" "field-symbols" "field-symbol" "class-data" "statics" "parameters"
      "select-options" "tables" "endclass" "endmethod" "endform" "endfunction" "endinterface"
      "report" "program" "aliases" "events" "definition" "implementation" "deferred" "include"
      "type-pools")
    (group $Token.keyword.declaration+4096 "data")
    (group $Token.keyword.declaration+256 "method" "methods" "class-methods" "form" "function")
    (group $Token.keyword.declaration+512 "class" "interface" "interfaces" "types")
    (group $Token.keyword+512 "type" "new" "value" "conv" "cast" "inheriting")
    (group $Token.keyword.control+512 "catch")
    (group $Token.keyword+2048
      "ref" "to" "table" "of" "standard" "sorted" "hashed" "line" "begin" "from")
    (group $Token.keyword+768 "call")
    (group $Token.keyword.control+1024 "perform")
    (group $Token.keyword.control
      "if" "elseif" "else" "endif" "case" "when" "endcase" "do" "enddo" "while" "endwhile" "loop"
      "endloop" "try" "cleanup" "endtry" "check" "exit" "continue" "return" "raise" "endat"
      "endselect" "leave" "stop" "retry" "then" "switch" "cond")
    (group $Token.keyword
      "read" "append" "insert" "modify" "delete" "clear" "free" "refresh" "sort" "collect" "move"
      "move-corresponding" "assign" "unassign" "write" "message" "concatenate" "split" "replace"
      "translate" "shift" "find" "into" "order" "by" "group" "having" "up" "rows" "single"
      "distinct" "inner" "join" "left" "outer" "on" "as" "descending" "using" "for" "all" "entries"
      "transporting" "assigning" "binary" "search" "index" "components" "corresponding" "appending"
      "separated" "respecting" "blanks" "occurrences" "first" "last" "with" "key" "unique"
      "non-unique" "empty" "default" "initial" "importing" "exporting" "changing" "returning"
      "raising" "exceptions" "optional" "reference" "public" "private" "protected" "section" "final"
      "abstract" "create" "read-only" "exact" "reduce" "filter" "let" "next" "init" "base" "commit"
      "rollback" "work" "authority-check" "set" "get" "field" "parameter" "testing" "risk" "level"
      "harmless" "duration" "start-of-selection" "end-of-selection" "initialization"
      "selection-screen" "describe" "handler" "add" "subtract" "multiply" "divide" "select" "update"
      "fields" "at" "end" "exception" "skip" "uline" "format")
    (group $Token.keyword+4096 "object")
    (group $Token.keyword.operator
      "and" "or" "not" "eq" "ne" "lt" "gt" "le" "ge" "is" "in" "bound" "assigned" "supplied"
      "between" "div" "mod" "cs" "cp" "co" "cn" "ca" "na" "ns" "np" "instance")
    (group $Token.type.builtin
      "string" "xstring" "abap_bool" "any" "int8" "decfloat16" "decfloat34" "utclong" "clike"
      "csequence" "numeric" "xsequence")
    (group $Token.boolean "abap_true" "abap_false")
    (group $Token.constant.builtin "space" "abap_undefined" "null")
    (group $Token.variable.special "me" "super"))

  ;; A '...' text field or `...` string literal; it ends at the line end, and
  ;; a doubled quote inside is an escape. Shared with matlab.
  (func $abapQuoted (param $q i32)
    (local $seg i32)
    (local.set $seg (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (block $done
      (loop $scan
        (global.set $ptr
          (call $scanFindSpecial
            (global.get $ptr)
            (global.get $end)
            (local.get $q)
            (i32.const 0)
            (i32.const 1)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (br_if $done (i32.ne (i32.load8_u (global.get $ptr)) (local.get $q)))
        (if (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (local.get $q))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $seg (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $seg))
            (global.set $ptr (local.get $seg))
            (br $scan)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr)))

  ;; Scan string template text from $ptr ($seg: its first unemitted byte)
  ;; to `|`, an embedded `{`, or $end; the text may span lines. Returns 1
  ;; after an opening `{`, 2 after the closing `|`, and 0 at $end.
  (func $abapTemplate (param $seg i32) (result i32)
    (local $c i32)
    (local $r i32)
    (block $done
      (loop $scan
        (global.set $ptr
          (call $scanFind3 (global.get $ptr) (i32.const "|") (i32.const "{") (i32.const 92)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (drop (call $stringEscapeAt (local.get $seg)))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (local.set $r (select (i32.const 1) (i32.const 2) (i32.eq (local.get $c) (i32.const "{"))))
        (if (i32.eq (local.get $r) (i32.const 1))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $seg (global.get $ptr))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok
          (select
            (enum.get $Token.punctuation.special)
            (enum.get $Token.string)
            (i32.eq (local.get $r) (i32.const 1)))
          (local.get $seg)
          (global.get $ptr))
        (local.set $seg (global.get $ptr))))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (local.get $r))

  ;; $tpl counts open string templates: 2n while the innermost of n is in its
  ;; text, 2n+1 inside its `{ }` expression (outer ones always are). $expect
  ;; is the capture a keyword armed for the next name (see $abapWords);
  ;; $member is 1 after a component selector (`-`, `->`, `=>`, `~`).
  (func $hlAbap
    (local $c i32)
    (local $c2 i32)
    (local $hl i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $v i32)
    (local $sel i32)
    (local $want i32)
    (local $expect i32)
    (local $member i32)
    (local $tpl i32)
    (local $w i64)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (if
          (i32.and
            (i32.ne (local.get $tpl) (i32.const 0))
            (i32.eqz (i32.and (local.get $tpl) (i32.const 1))))
          (then
            (local.set $v (call $abapTemplate (global.get $ptr)))
            (if (i32.eq (local.get $v) (i32.const 1))
              (then (local.set $tpl (i32.add (local.get $tpl) (i32.const 1)))))
            (if (i32.eq (local.get $v) (i32.const 2))
              (then
                (local.set $tpl
                  (select
                    (i32.const 0)
                    (i32.sub (local.get $tpl) (i32.const 1))
                    (i32.eq (local.get $tpl) (i32.const 2))))))))
        (local.set $lhs (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (local.set $want (local.get $expect))
        (local.set $expect (i32.const 0))
        (local.set $sel (local.get $member))
        (local.set $member (i32.const 0))

        ;; `*` in column 1 comments out its line, `"` the rest of one; `"!` is
        ;; ABAP Doc. $p keeps the byte before the token for the `-` selector below.
        (local.set $p
          (select
            (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1)))
            (i32.const 10)
            (i32.gt_u (local.get $lhs) (global.get $srcBase))))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const 34))
            (i32.and (i32.eq (local.get $c) (i32.const "*")) (byteset.get "\n\r" (local.get $p))))
          (then
            (call $lexLineComment
              (i32.const 1)
              (select
                (enum.get $Token.comment.doc)
                (enum.get $Token.comment)
                (i32.and (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c2) (i32.const "!")))))
            (local.set $expect (local.get $want))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 39)) (i32.eq (local.get $c) (i32.const "`")))
          (then
            (call $abapQuoted (local.get $c))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "|"))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $tpl (i32.add (i32.or (local.get $tpl) (i32.const 1)) (i32.const 1)))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "}")) (i32.and (local.get $tpl) (i32.const 1)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (local.set $tpl (i32.sub (local.get $tpl) (i32.const 1)))
            (br $next)))

        ;; an identifier start other than `$`
        (if
          (i32.or
            (i32.ge_u (local.get $c) (i32.const 0x80))
            (i32.or
              (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
              (i32.eq (local.get $c) (i32.const "_"))))
          (then
            ;; the first word, then any hyphenated run (`field-symbols`, `ls_row-field`)
            (call $scanIdentRun (i32.const "_"))
            (local.set $p (global.get $ptr))
            (if
              (i32.and
                (i32.eq (call $templateByte (local.get $p)) (i32.const "-"))
                (call $lexIsIdentContinue (call $templateByte (i32.add (local.get $p) (i32.const 1)))))
              (then (call $scanIdentRun (i32.const "-"))))
            (local.set $rhs (global.get $ptr))
            (local.set $v (i32.const -1))
            (if (i32.eqz (local.get $sel))
              (then
                (local.set $v
                  (call $lexLowerCopy (local.get $lhs) (local.get $rhs) (i32.const $mem.lexLowerScratch)))
                (local.set $c (local.get $v))
                (local.set $v
                  (keyword-table.value $abapWords
                    (i32.const $mem.lexLowerScratch)
                    (i32.add (i32.const $mem.lexLowerScratch) (local.get $c))))
                (if (i32.lt_s (local.get $v) (i32.const 0))
                  (then
                    (local.set $w (i64.load (i32.const $mem.lexLowerScratch)))
                    (if
                      (i32.and
                        (i32.eq (local.get $c) (i32.const 4))
                        (i32.eq (i32.wrap_i64 (local.get $w)) (i32.const "like")))
                      (then (local.set $v (i32.or (enum.get $Token.keyword) (i32.const 512)))))
                    (if
                      (i32.or
                        (i32.and
                          (i32.eq (local.get $c) (i32.const 5))
                          (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "where")))
                        (i32.and
                          (i32.eq (local.get $c) (i32.const 9))
                          (i32.and
                            (i64.eq (local.get $w) (i64.const "ascendin"))
                            (i32.eq (i32.load8_u (i32.const $mem.lexLowerScratch+8)) (i32.const "g")))))
                      (then (local.set $v (enum.get $Token.keyword))))))))
            (if (i32.ge_s (local.get $v) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $v) (i32.const 255)))
                (if
                  (i32.and
                    (i32.ne (i32.and (local.get $v) (i32.const 4096)) (i32.const 0))
                    (i32.eq (local.get $want) (i32.const 2)))
                  (then (local.set $hl (enum.get $Token.type.builtin))))
                (local.set $expect
                  (select
                    (local.get $want)
                    (i32.and (i32.shr_u (local.get $v) (i32.const 8)) (i32.const 7))
                    (i32.and (local.get $v) (i32.const 2048))))
                ;; `CALL METHOD` and `CALL FUNCTION` call; they define nothing
                (if (i32.eq (local.get $want) (i32.const 3))
                  (then (local.set $expect (i32.const 0))))
                (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
                (br $next)))
            ;; a name ends at its first hyphen, a component selector
            (global.set $ptr (local.get $p))
            (local.set $c (call $templateByte (local.get $p)))
            (local.set $hl
              (select
                (enum.get $Token.function)
                (enum.get $Token.variable)
                (i32.eq (local.get $c) (i32.const "("))))
            (if (local.get $sel)
              (then
                (local.set $hl
                  (select
                    (enum.get $Token.function.method)
                    (enum.get $Token.property)
                    (i32.eq (local.get $c) (i32.const "(")))))
              (else
                (if (i32.eq (local.get $want) (i32.const 1))
                  (then (local.set $hl (enum.get $Token.function.definition))))
                (if (i32.eq (local.get $want) (i32.const 2))
                  (then (local.set $hl (enum.get $Token.type))))
                (if (i32.eq (local.get $want) (i32.const 4))
                  (then (local.set $hl (enum.get $Token.function))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $p))
            (if (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $rhs))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $p) (global.get $ptr))
                (local.set $member (i32.const 1))))
            (br $next)))

        (if (call $lexIsDigit (local.get $c))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; a field symbol, `<fs>`
        (if (i32.and (i32.eq (local.get $c) (i32.const "<")) (call $lexIsIdentStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const ">"))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
                (br $next)))))
        ;; pragmas, `##NEEDED`
        (if (i32.and (i32.eq (local.get $c) (i32.const "#")) (i32.eq (local.get $c2) (i32.const "#")))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
            (call $scanIdentRun (i32.const "_"))
            (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))
            (local.set $expect (local.get $want))
            (br $next)))
        ;; `->`, `=>`, `~`, and the `-` after `<fs>`, `)`, or `]` select a component
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (local.set $hl (enum.get $Token.none))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const "~"))
            (i32.and
              (i32.eq (local.get $c2) (i32.const ">"))
              (i32.or (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c) (i32.const "=")))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.ne (local.get $c) (i32.const "~"))))
            (local.set $hl (enum.get $Token.operator))
            (local.set $member (i32.const 1))))
        (if
          (i32.and
            (i32.and (i32.eq (local.get $c) (i32.const "-")) (call $lexIsIdentStart (local.get $c2)))
            (i32.or (i32.eq (local.get $p) (i32.const ">")) (byteset.get ")]" (local.get $p))))
          (then
            (local.set $hl (enum.get $Token.punctuation.delimiter))
            (local.set $member (i32.const 1))))
        (if (i32.eqz (local.get $hl))
          (then
            (if (byteset.get "!#%&*+-/:<=>?@^|~" (local.get $c))
              (then (local.set $hl (enum.get $Token.operator))))
            (if (byteset.get "()[]{}" (local.get $c))
              (then (local.set $hl (enum.get $Token.punctuation.bracket))))
            (if (byteset.get ".,:" (local.get $c))
              (then
                (local.set $hl (enum.get $Token.punctuation.delimiter))
                ;; a chain colon keeps the capture: `TYPES: ty_id TYPE i.`
                (if (i32.eq (local.get $c) (i32.const ":"))
                  (then (local.set $expect (local.get $want))))))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
