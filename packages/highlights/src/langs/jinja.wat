(module
  (import "../common.wat")
  (import "./html.wat")

  ;; Token in the low byte; 256 a tag name that is a plain word elsewhere
  ;; (Liquid's `section`); 512 * the raw block its tag opens; 2048 * the context
  ;; it gives the next word (9 starts Liquid line mode).
  (keyword-table $twigWords $mem.twigWords $mem.jinjaWords
    (group $Token.keyword.control "if" "elseif" "else" "endif" "for" "endfor")
    (group $Token.keyword.import "extends" "include" "import" "from" "use" "embed")
    (group $Token.keyword.operator "and" "or" "not" "in" "matches" "starts" "ends")
    (group $Token.keyword.operator+8192 "is")
    (group $Token.keyword "as" "with" "only" "ignore" "missing")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "null" "none")
    (group $Token.variable.special "loop" "_self" "_context")
    (group $Token.keyword+10496 "macro")
    (group $Token.keyword+1280 "verbatim"))

  (keyword-table $jinjaWords $mem.jinjaWords $mem.liquidWords
    (group $Token.keyword.control "if" "elif" "else" "endif" "for" "endfor" "break" "continue")
    (group $Token.keyword.import "extends" "include" "import" "from")
    (group $Token.keyword.operator "and" "or" "not" "in")
    (group $Token.keyword.operator+8192 "is")
    (group $Token.keyword "as" "with" "without" "context" "recursive" "ignore" "missing" "scoped")
    (group $Token.boolean "true" "false" "True" "False")
    (group $Token.constant.builtin "none" "None")
    (group $Token.variable.special "loop" "self" "super" "varargs" "kwargs" "caller")
    (group $Token.keyword+10496 "macro")
    (group $Token.keyword+768 "raw"))

  (keyword-table $liquidWords $mem.liquidWords $mem.handlebarsWords
    (group $Token.keyword.control
      "if" "elsif" "else" "endif" "unless" "endunless" "case" "when" "endcase" "for" "endfor"
      "break" "continue" "tablerow" "endtablerow")
    (group $Token.keyword.import+256 "include" "render" "section" "sections" "layout")
    (group $Token.keyword.operator "and" "or" "contains" "in")
    (group $Token.keyword "reversed" "with" "as" "by")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "nil" "null" "blank" "empty")
    (group $Token.variable.special "forloop" "tablerowloop")
    (group $Token.keyword+768 "raw")
    (group $Token.keyword+1792 "comment")
    (group $Token.keyword+18688 "liquid"))

  (keyword-table $handlebarsWords $mem.handlebarsWords $mem.pugWords
    (group $Token.keyword.control "else" "if" "unless")
    (group $Token.keyword "as")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "null" "undefined")
    (group $Token.variable.special "this"))

  (func $jinjaTrim (param $c i32) (param $dialect i32) (param $kind i32) (result i32)
    (i32.or
      (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.ne (local.get $dialect) (i32.const 3)))
      (i32.or
        (i32.and (i32.eq (local.get $c) (i32.const "~")) (i32.and (local.get $dialect) (i32.const 1)))
        (i32.and
          (i32.eq (local.get $c) (i32.const "+"))
          (i32.eqz (i32.or (local.get $dialect) (i32.xor (local.get $kind) (i32.const 2))))))))

  ;; While a `{` is open ($braces) a `}}` closes it instead: `{{ {'a': {'b': 1}} }}`.
  (func $jinjaCloser (param $p i32) (param $kind i32) (param $dialect i32) (param $braces i32) (result i32)
    (local.set $p
      (i32.add
        (local.get $p)
        (call $jinjaTrim (call $templateByte (local.get $p)) (local.get $dialect) (local.get $kind))))
    (if
      (i32.or
        (i32.and (i32.ne (local.get $kind) (i32.const 2)) (i32.ne (local.get $braces) (i32.const 0)))
        (i32.or
          (i32.ne
            (call $templateByte (local.get $p))
            (select (i32.const "%") (i32.const "}") (i32.eq (local.get $kind) (i32.const 2))))
          (i32.ne (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const "}"))))
      (then (return (i32.const 0))))
    (local.set $p (i32.add (local.get $p) (i32.const 2)))
    (if (i32.eq (local.get $kind) (i32.const 3))
      (then
        (if (i32.ne (call $templateByte (local.get $p)) (i32.const "}"))
          (then (return (i32.const 0))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))))
    (local.get $p))

  (func $jinjaOpens (param $p i32) (param $dialect i32) (result i32)
    (local $c i32)
    (local.set $c (call $templateByte (i32.add (local.get $p) (i32.const 1))))
    (i32.and
      (i32.eq (call $templateByte (local.get $p)) (i32.const "{"))
      (i32.or
        (i32.eq (local.get $c) (i32.const "{"))
        (i32.or
          (i32.and (i32.eq (local.get $c) (i32.const "%")) (i32.ne (local.get $dialect) (i32.const 3)))
          (i32.and (i32.eq (local.get $c) (i32.const "#")) (i32.lt_u (local.get $dialect) (i32.const 2)))))))

  ;; Comments, declarations, and script/style start tags are scanned whole, so
  ;; template tags inside them stay text. Inside a start tag the range also stops
  ;; after the next `>`, so no scan runs far past the tag.
  (func $jinjaNextCut (param $p i32) (param $dialect i32) (param $inTag i32) (result i32)
    (local $c i32)
    (block $done
      (loop $scan
        (local.set $p
          (call $lexFindEither
            (local.get $p)
            (i32.const "{")
            (select (i32.const ">") (i32.const "<") (local.get $inTag))))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "{"))
          (then (br_if $done (call $jinjaOpens (local.get $p) (local.get $dialect))))
          (else
            (if (local.get $inTag)
              (then (return (i32.add (local.get $p) (i32.const 1)))))
            (local.set $c (call $templateByte (i32.add (local.get $p) (i32.const 1))))
            (br_if $done
              (i32.or (i32.eq (local.get $c) (i32.const "!")) (i32.eq (local.get $c) (i32.const "?"))))
            (if (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "s"))
              (then
                (br_if $done
                  (call $rawTextKind
                    (i32.add (local.get $p) (i32.const 1))
                    (call $htmlNameEnd (i32.add (local.get $p) (i32.const 1)))))))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (local.get $p))

  ;; Returns the tag's state (see $hlJinjaImpl).
  (func $jinjaOpen (param $dialect i32) (result i32)
    (local $c i32)
    (local $kind i32)
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (local.set $c (i32.load8_u offset=1 (local.get $lhs)))
    (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
    (if (i32.eq (local.get $c) (i32.const "#"))
      (then
        (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
        (return (i32.const 4))))
    (local.set $kind (select (i32.const 2) (i32.const 1) (i32.eq (local.get $c) (i32.const "%"))))
    (global.set $ptr
      (i32.add
        (global.get $ptr)
        (call $jinjaTrim (call $templateByte (global.get $ptr)) (local.get $dialect) (local.get $kind))))
    (if (i32.eq (local.get $dialect) (i32.const 3))
      (then
        (local.set $c (call $templateByte (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const "!"))
          (then
            (local.set $kind (i32.const 5))
            (if
              (i32.and
                (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "-"))
                (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const "-")))
              (then
                (local.set $kind (i32.const 6))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
            (return (local.get $kind))))
        (local.set $kind (i32.const 0x61))
        (if (i32.eq (local.get $c) (i32.const "{"))
          (then
            (local.set $kind (i32.const 0x63))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (if (i32.eq (local.get $c) (i32.const "&"))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
        (local.set $lhs (global.get $ptr))
        (if (i32.eq (local.get $c) (i32.const ">"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.keyword.import) (local.get $lhs) (global.get $ptr))
            (return (i32.const 0x31))))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const "#"))
            (i32.or (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c) (i32.const "^"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $c (call $templateByte (global.get $ptr)))
            (if (i32.or (i32.eq (local.get $c) (i32.const ">")) (i32.eq (local.get $c) (i32.const "*")))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $scanIdentRun (i32.const "-"))
            (call $emitTok (enum.get $Token.keyword.control) (local.get $lhs) (global.get $ptr))
            (return (i32.const 1))))
        (return (local.get $kind))))
    (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
    (select (i32.const 0x12) (i32.const 1) (i32.eq (local.get $kind) (i32.const 2))))

  ;; Returns the state to resume with. Context, what the next word is: 1 a tag
  ;; name, 2 a member, 3 a filter or partial, 4 a test, 5 a macro name, 6 a
  ;; Handlebars first path (a helper when arguments follow), 7 just after a word,
  ;; 8 a Handlebars block param.
  (func $jinjaTag (param $state i32) (param $dialect i32) (result i32)
    (local $c i32)
    (local $ctx i32)
    (local $gap i32)
    (local $hl i32)
    (local $kind i32)
    (local $lhs i32)
    (local $n i32)
    (local $p i32)
    (local $save i32)
    (local $v i32)
    (local.set $kind (i32.and (local.get $state) (i32.const 7)))
    (local.set $ctx (i32.and (i32.shr_u (local.get $state) (i32.const 4)) (i32.const 15)))
    (local.set $state (i32.and (local.get $state) (i32.const -248)))
    (local.set $lhs (global.get $ptr))
    (block $done
      (if (i32.ge_u (local.get $kind) (i32.const 4))
        (then
          (local.set $p (global.get $ptr))
          (global.set $ptr (global.get $end))
          (block $found
            (loop $find
              (local.set $p
                (call $lexFindByte
                  (local.get $p)
                  (select (i32.const "#") (i32.const "}") (i32.eq (local.get $kind) (i32.const 4)))))
              (br_if $found (i32.ge_u (i32.add (local.get $p) (i32.const 1)) (global.get $end)))
              (if (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "}"))
                (then
                  (local.set $c (local.get $p))
                  (if (i32.eq (local.get $kind) (i32.const 6))
                    (then
                      (local.set $c
                        (i32.sub
                          (local.get $c)
                          (i32.and
                            (i32.gt_u (local.get $c) (local.get $lhs))
                            (i32.eq (i32.load8_u (i32.sub (local.get $c) (i32.const 1))) (i32.const "~")))))
                      (local.set $c
                        (select
                          (local.get $c)
                          (i32.const 0)
                          (i32.and
                            (i32.ge_u (i32.sub (local.get $c) (i32.const 2)) (local.get $lhs))
                            (i32.eq
                              (i32.load16_u (i32.sub (local.get $c) (i32.const 2)))
                              (i32.const "--")))))))
                  (if (local.get $c)
                    (then
                      (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
                      (local.set $kind (i32.const 0))
                      (br $found)))))
              (local.set $p (i32.add (local.get $p) (i32.const 1)))
              (br $find)))
          (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
          (br $done)))
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (i32.and (local.get $state) (i32.const 8))
          (then
            (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
              (then (local.set $ctx (i32.const 1))))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $p
          (call $jinjaCloser
            (local.get $lhs)
            (local.get $kind)
            (local.get $dialect)
            (i32.and (local.get $state) (i32.const 0xff00))))
        (if (local.get $p)
          (then
            (global.set $ptr (local.get $p))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (local.get $p))
            (local.set $kind (i32.const 0))
            (local.set $ctx (i32.const 0))
            (local.set $state (i32.and (local.get $state) (i32.const 0x3000000)))
            (br $done)))
        (block $emit
          (if
            (i32.or
              (call $lexIsIdentStart (local.get $c))
              (i32.and (i32.eq (local.get $c) (i32.const "@")) (i32.eq (local.get $dialect) (i32.const 3))))
            (then
              (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
              (call $scanIdentRun
                (select (i32.const "-") (i32.const "_") (i32.ge_u (local.get $dialect) (i32.const 2))))
              (if (i32.eq (local.get $c) (i32.const "@"))
                (then
                  (local.set $hl (enum.get $Token.variable.special))
                  (local.set $ctx (i32.const 7))
                  (br $emit)))
              (if (i32.eq (local.get $dialect) (i32.const 2))
                (then
                  (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "?"))
                    (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                  ;; in `x-}}` the dash belongs to the closer
                  (if
                    (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const "-"))
                    (then
                      (if
                        (call $jinjaCloser
                          (i32.sub (global.get $ptr) (i32.const 1))
                          (local.get $kind)
                          (local.get $dialect)
                          (i32.const 0))
                        (then (global.set $ptr (i32.sub (global.get $ptr) (i32.const 1)))))))))
              (local.set $v (i32.const -1))
              (if (i32.eqz (local.get $dialect))
                (then (local.set $v (keyword-table.value $jinjaWords (local.get $lhs) (global.get $ptr)))))
              (if (i32.eq (local.get $dialect) (i32.const 1))
                (then (local.set $v (keyword-table.value $twigWords (local.get $lhs) (global.get $ptr)))))
              (if (i32.eq (local.get $dialect) (i32.const 2))
                (then (local.set $v (keyword-table.value $liquidWords (local.get $lhs) (global.get $ptr)))))
              (if (i32.eq (local.get $dialect) (i32.const 3))
                (then
                  (local.set $v (keyword-table.value $handlebarsWords (local.get $lhs) (global.get $ptr)))))
              (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
              (local.set $n (call $templateByte (local.get $p)))
              (if (i32.eq (local.get $ctx) (i32.const 1))
                (then
                  (local.set $hl (enum.get $Token.keyword))
                  (local.set $ctx (i32.const 0))
                  (if (i32.ge_s (local.get $v) (i32.const 0))
                    (then
                      (local.set $hl (i32.and (local.get $v) (i32.const 255)))
                      (if (i32.eqz (i32.and (local.get $state) (i32.const 8)))
                        (then
                          (local.set $state
                            (i32.or
                              (local.get $state)
                              (i32.shl
                                (i32.and (i32.shr_u (local.get $v) (i32.const 9)) (i32.const 3))
                                (i32.const 24))))))
                      (local.set $ctx (i32.shr_u (local.get $v) (i32.const 11)))
                      (if (i32.eq (local.get $ctx) (i32.const 9))
                        (then
                          (local.set $state (i32.or (local.get $state) (i32.const 8)))
                          (local.set $ctx (i32.const 1))))))
                  (br $emit)))
              (if (i32.eq (local.get $ctx) (i32.const 2))
                (then
                  (local.set $hl
                    (select
                      (enum.get $Token.function.method)
                      (enum.get $Token.property)
                      (i32.eq (local.get $n) (i32.const "("))))
                  (local.set $ctx (i32.const 7))
                  (br $emit)))
              (if (i32.eq (local.get $ctx) (i32.const 4))
                (then
                  ;; `is not defined` keeps waiting for the test
                  (if (i32.eq (i32.and (local.get $v) (i32.const 255)) (enum.get $Token.keyword.operator))
                    (then
                      (local.set $hl (enum.get $Token.keyword.operator))
                      (br $emit)))
                  (local.set $ctx (i32.const 3))))
              (if (i32.eq (local.get $ctx) (i32.const 3))
                (then
                  (local.set $hl (enum.get $Token.function))
                  (local.set $ctx (i32.const 7))
                  (br $emit)))
              (if (i32.eq (local.get $ctx) (i32.const 5))
                (then
                  (local.set $hl (enum.get $Token.function.definition))
                  (local.set $ctx (i32.const 7))
                  (br $emit)))
              (if (i32.eq (local.get $ctx) (i32.const 8))
                (then
                  (local.set $hl (enum.get $Token.variable.parameter))
                  (br $emit)))
              (local.set $save (local.get $ctx))
              (local.set $ctx (i32.const 7))
              (local.set $hl (enum.get $Token.function))
              (br_if $emit
                (i32.and
                  (i32.lt_u (local.get $dialect) (i32.const 2))
                  (i32.eq (local.get $n) (i32.const "("))))
              (local.set $hl (enum.get $Token.variable.parameter))
              (local.set $c (call $templateByte (i32.add (local.get $p) (i32.const 1))))
              (br_if $emit
                (i32.and
                  (i32.and
                    (i32.eq (local.get $n) (i32.const "="))
                    (i32.and (i32.ne (local.get $c) (i32.const "=")) (i32.ne (local.get $c) (i32.const ">"))))
                  (i32.or
                    (i32.eq (local.get $dialect) (i32.const 3))
                    (i32.and
                      (i32.lt_u (local.get $dialect) (i32.const 2))
                      (i32.ne (i32.and (local.get $state) (i32.const 0xff0000)) (i32.const 0))))))
              (if
                (i32.and
                  (i32.eq (call $templateByte (global.get $ptr)) (i32.const ":"))
                  (i32.ne (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const ":")))
                (then
                  (br_if $emit (i32.eq (local.get $dialect) (i32.const 2)))
                  (local.set $hl (enum.get $Token.property))
                  (br_if $emit (i32.eq (local.get $dialect) (i32.const 1)))))
              (if
                (i32.and
                  (i32.ge_s (local.get $v) (i32.const 0))
                  (i32.eqz (i32.and (local.get $v) (i32.const 256))))
                (then
                  (local.set $hl (i32.and (local.get $v) (i32.const 255)))
                  (local.set $ctx
                    (select
                      (i32.shr_u (local.get $v) (i32.const 11))
                      (i32.const 7)
                      (i32.ge_u (local.get $v) (i32.const 2048))))
                  (br $emit)))
              (local.set $hl (enum.get $Token.function))
              (br_if $emit
                (i32.and
                  (i32.and
                    (i32.eq (local.get $save) (i32.const 6))
                    (i32.gt_u (local.get $p) (global.get $ptr)))
                  (i32.and
                    (i32.gt_u (local.get $n) (i32.const 32))
                    (i32.and
                      (i32.ne (local.get $n) (i32.const "}"))
                      (i32.and
                        (i32.ne (local.get $n) (i32.const "~"))
                        (i32.ne (local.get $n) (i32.const ")")))))))
              (local.set $hl (enum.get $Token.variable))
              (br $emit)))
          (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
            (then
              (if (i32.eq (local.get $dialect) (i32.const 2))
                (then (call $lexRawString (local.get $c) (i32.const 0) (enum.get $Token.string)))
                (else (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))))
              (local.set $ctx (i32.const 0))
              (br $next)))
          (if (call $lexIsDigit (local.get $c))
            (then
              (call $lexScanNumber)
              (local.set $hl (enum.get $Token.number))
              (local.set $ctx (i32.const 0))
              (br $emit)))
          (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
          (if (i32.eq (local.get $c) (i32.const "."))
            (then
              (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "."))
                (then
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (local.set $hl
                    (select
                      (enum.get $Token.variable.special)
                      (enum.get $Token.operator)
                      (i32.eq (local.get $dialect) (i32.const 3))))
                  (local.set $ctx (i32.const 7))
                  (br $emit)))
              (if
                (i32.and (i32.eq (local.get $dialect) (i32.const 3)) (i32.ne (local.get $ctx) (i32.const 7)))
                (then
                  (local.set $hl (enum.get $Token.variable.special))
                  (local.set $ctx (i32.const 7))
                  (br $emit)))
              (local.set $hl (enum.get $Token.punctuation.delimiter))
              (local.set $ctx (i32.const 2))
              (br $emit)))
          (if
            (i32.and
              (i32.eq (local.get $c) (i32.const "/"))
              (i32.and (i32.eq (local.get $dialect) (i32.const 3)) (i32.eq (local.get $ctx) (i32.const 7))))
            (then
              (local.set $hl (enum.get $Token.punctuation.delimiter))
              (local.set $ctx (i32.const 2))
              (br $emit)))
          (if (i32.eq (local.get $c) (i32.const "|"))
            (then
              (if (i32.eq (local.get $dialect) (i32.const 3))
                (then
                  (local.set $hl (enum.get $Token.punctuation.bracket))
                  (local.set $ctx
                    (select (i32.const 0) (i32.const 8) (i32.eq (local.get $ctx) (i32.const 8))))
                  (br $emit)))
              (local.set $hl (enum.get $Token.operator))
              (local.set $ctx (i32.const 3))
              (br $emit)))
          (if (byteset.get "()[]{}" (local.get $c))
            (then
              (local.set $hl (enum.get $Token.punctuation.bracket))
              (local.set $ctx (i32.const 7))
              (if (byteset.get "([{" (local.get $c))
                (then
                  (local.set $ctx (i32.const 0))
                  (if (i32.eq (local.get $c) (i32.const "{"))
                    (then
                      (if
                        (i32.and
                          (i32.lt_u (local.get $dialect) (i32.const 2))
                          (i32.lt_u (i32.and (local.get $state) (i32.const 0xff00)) (i32.const 0xff00)))
                        (then (local.set $state (i32.add (local.get $state) (i32.const 0x100))))))
                    (else
                      (if (i32.lt_u (i32.and (local.get $state) (i32.const 0xff0000)) (i32.const 0xff0000))
                        (then (local.set $state (i32.add (local.get $state) (i32.const 0x10000)))))
                      (if (i32.eq (local.get $dialect) (i32.const 3))
                        (then (local.set $ctx (i32.const 6)))))))
                (else
                  (if (i32.eq (local.get $c) (i32.const "}"))
                    (then
                      (if (i32.and (local.get $state) (i32.const 0xff00))
                        (then (local.set $state (i32.sub (local.get $state) (i32.const 0x100))))))
                    (else
                      (if (i32.and (local.get $state) (i32.const 0xff0000))
                        (then (local.set $state (i32.sub (local.get $state) (i32.const 0x10000)))))))))
              (br $emit)))
          (if (byteset.get ":,;" (local.get $c))
            (then
              (local.set $hl (enum.get $Token.punctuation.delimiter))
              (local.set $ctx (i32.const 0))
              (br $emit)))
          (if
            (i32.and
              (i32.eq (local.get $c) (i32.const "#"))
              (i32.and (i32.eq (local.get $dialect) (i32.const 2)) (i32.eq (local.get $ctx) (i32.const 1))))
            (then
              (local.set $save (global.get $end))
              (call $scanToLineEnd)
              (local.set $n (global.get $ptr))
              (global.set $end (local.get $n))
              (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
              (block $closed
                (loop $find
                  (local.set $p (call $lexFindByte (local.get $p) (i32.const "%")))
                  (br_if $closed (i32.ge_u (local.get $p) (local.get $n)))
                  (br_if $closed
                    (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const "}")))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br $find)))
              (global.set $end (local.get $save))
              (if
                (i32.and
                  (i32.lt_u (local.get $p) (local.get $n))
                  (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const "-")))
                (then (local.set $p (i32.sub (local.get $p) (i32.const 1)))))
              (global.set $ptr (local.get $p))
              (local.set $state (i32.or (local.get $state) (i32.const 8)))
              (local.set $hl (enum.get $Token.comment))
              (local.set $ctx (i32.const 0))
              (br $emit)))
          (local.set $hl (enum.get $Token.operator))
          (local.set $ctx (i32.const 0))
          ;; an operator run stops at the closer and before `|`
          (if (byteset.get "!%&*+-/<=>?^|~" (local.get $c))
            (then
              (block $opDone
                (loop $op
                  (local.set $n (call $templateByte (global.get $ptr)))
                  (br_if $opDone (i32.eqz (byteset.get "!%&*+-/<=>?^|~" (local.get $n))))
                  (br_if $opDone (i32.eq (local.get $n) (i32.const "|")))
                  (br_if $opDone
                    (call $jinjaCloser
                      (global.get $ptr)
                      (local.get $kind)
                      (local.get $dialect)
                      (i32.and (local.get $state) (i32.const 0xff00))))
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (br $op)))
              (br $emit)))
          (local.set $hl (enum.get $Token.none)))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next)))
    (i32.or
      (i32.or (local.get $state) (local.get $kind))
      (i32.shl (local.get $ctx) (i32.const 4))))

  ;; Raw kinds: 1 `raw` text, 2 Twig `verbatim`, 3 Liquid `comment`. The end tag
  ;; counts only on one line, so a chunk end cannot split it.
  (func $jinjaRaw (param $state i32) (param $dialect i32) (result i32)
    (local $hl i32)
    (local $kind i32)
    (local $len i32)
    (local $lhs i32)
    (local $p i32)
    (local $q i32)
    (local $w i64)
    (local.set $kind (i32.shr_u (local.get $state) (i32.const 24)))
    (local.set $hl
      (select
        (enum.get $Token.comment)
        (enum.get $Token.text.literal)
        (i32.eq (local.get $kind) (i32.const 3))))
    (local.set $len
      (select
        (i32.const 6)
        (select (i32.const 11) (i32.const 10) (i32.eq (local.get $kind) (i32.const 2)))
        (i32.eq (local.get $kind) (i32.const 1))))
    (local.set $lhs (global.get $ptr))
    (local.set $p (global.get $ptr))
    (block $done
      (loop $find
        (local.set $p (call $lexFindByte (local.get $p) (i32.const "{")))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (if (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const "%"))
          (then
            (local.set $q (i32.add (local.get $p) (i32.const 2)))
            (local.set $q
              (call $lexSkipSpaceAt
                (i32.add
                  (local.get $q)
                  (call $jinjaTrim (call $templateByte (local.get $q)) (local.get $dialect) (i32.const 2)))))
            ;; wide loads stay inside the input slack
            (local.set $w (i64.load (local.get $q)))
            (if
              (i32.and
                (i32.and
                  (i32.le_u (i32.add (local.get $q) (local.get $len)) (global.get $end))
                  (i32.eqz
                    (call $lexIsIdentContinue
                      (call $templateByte (i32.add (local.get $q) (local.get $len))))))
                (select
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "endraw"))
                  (select
                    (i32.and
                      (i64.eq (local.get $w) (i64.const "endverba"))
                      (i32.eq
                        (i32.and (i32.load offset=8 (local.get $q)) (i32.const 0xffffff))
                        (i32.const "tim")))
                    (i32.and
                      (i64.eq (local.get $w) (i64.const "endcomme"))
                      (i32.eq (i32.load16_u offset=8 (local.get $q)) (i32.const "nt")))
                    (i32.eq (local.get $kind) (i32.const 2)))
                  (i32.eq (local.get $kind) (i32.const 1))))
              (then
                (call $emitTok (local.get $hl) (local.get $lhs) (local.get $p))
                (global.set $ptr (local.get $p))
                (return (i32.const 0))))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $find)))
    (global.set $ptr (global.get $end))
    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
    (local.get $state))

  ;; $dialect: 0 Jinja, 1 Twig, 2 Liquid, 3 Handlebars. A template tag inside a
  ;; start tag pauses it; $tag keeps its attribute state like $htmlOpenTag. An
  ;; open template tag or raw block lives in $state:
  ;;   bits 0-2   tag kind: 1 `}}`, 2 `%}`, 3 `}}}`, 4 `#}`, 5 `}}` comment,
  ;;              6 `--}}` comment; 0 outside a tag
  ;;   bit 3      Liquid line mode
  ;;   bits 4-7   next-word context (see $jinjaTag)
  ;;   bits 8-15  open `{` count
  ;;   bits 16-23 open `(` and `[` count
  ;;   bits 24-25 the raw block after the tag (see $jinjaRaw)
  ;; A start tag cut by a chunk end is stream region 23, folded back into $tag at
  ;; the end of each run.
  (func $hlJinjaImpl (param $dialect i32)
    (local $c i32)
    (local $p i32)
    (local $r i32)
    (local $save i32)
    (local $state i32)
    (local $tag i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (if (i32.and (local.get $state) (i32.const 7))
          (then
            (local.set $state (call $jinjaTag (local.get $state) (local.get $dialect)))
            (br $next)))
        (if (local.get $state)
          (then
            (local.set $state (call $jinjaRaw (local.get $state) (local.get $dialect)))
            (br $next)))
        (local.set $save (global.get $end))
        (global.set $htmlOpenTag (i32.const 0))
        (if (local.get $tag)
          (then
            (local.set $p (call $jinjaNextCut (global.get $ptr) (local.get $dialect) (i32.const 1)))
            (global.set $end (local.get $p))
            (local.set $r
              (call $htmlAttrs
                (i32.and (i32.shr_u (local.get $tag) (i32.const 1)) (i32.const 1))
                (i32.and (i32.shr_u (local.get $tag) (i32.const 8)) (i32.const 255))
                (i32.shr_u (local.get $tag) (i32.const 16))
                (i32.const 23)))
            (global.set $end (local.get $save))
            (local.set $tag (global.get $htmlOpenTag))
            (global.set $htmlOpenTag (i32.const 0))
            ;; a script or style body is opaque to template tags
            (call $htmlTagEnd (local.get $r))
            (br_if $next
              (i32.or
                (i32.or (i32.eqz (local.get $tag)) (i32.ne (global.get $ptr) (local.get $p)))
                (i32.eqz (call $jinjaOpens (global.get $ptr) (local.get $dialect))))))
          (else
            (local.set $p (call $jinjaNextCut (global.get $ptr) (local.get $dialect) (i32.const 0)))
            (global.set $end (local.get $p))
            (call $htmlLex (i32.const 23))
            (global.set $end (local.get $save))
            (local.set $tag (global.get $htmlOpenTag))
            (global.set $htmlOpenTag (i32.const 0))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (if (call $jinjaOpens (global.get $ptr) (local.get $dialect))
          (then
            (local.set $tag (i32.and (local.get $tag) (i32.const -3)))
            (local.set $state (call $jinjaOpen (local.get $dialect)))
            (br $next)))
        (br_if $next (local.get $tag))
        (local.set $c (i32.load8_u offset=1 (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const "!"))
          (then
            (if
              (i32.and
                (i32.le_u (i32.add (global.get $ptr) (i32.const 4)) (global.get $end))
                (i32.eq (i32.load (global.get $ptr)) (i32.const "<!--")))
              (then (call $htmlComment (global.get $ptr)))
              (else (call $htmlDecl (global.get $ptr) (i32.const 0) (enum.get $Token.tag.doctype))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "?"))
          (then
            (call $htmlDecl (global.get $ptr) (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (local.set $p (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.bracket.html) (global.get $ptr) (local.get $p))
        (global.set $ptr (call $htmlNameEnd (local.get $p)))
        (call $emitTok (enum.get $Token.tag) (local.get $p) (global.get $ptr))
        (local.set $tag
          (i32.or
            (i32.const 1)
            (i32.shl (call $rawTextKind (local.get $p) (global.get $ptr)) (i32.const 16))))
        (br $next)))
    (if (i32.eq (global.get $streamRegionKind) (i32.const 23))
      (then
        (local.set $tag
          (i32.or
            (i32.or (i32.const 1) (i32.shl (global.get $streamB) (i32.const 1)))
            (i32.or
              (i32.shl (global.get $streamC) (i32.const 8))
              (i32.shl (global.get $streamA) (i32.const 16)))))
        (global.set $streamRegionKind (i32.const 0))
        (global.set $streamA (i32.const 0))
        (global.set $streamB (i32.const 0))
        (global.set $streamC (i32.const 0)))))

  (func $hlJinja
    (call $hlJinjaImpl (i32.const 0)))
)
