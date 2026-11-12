(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (import "@pierre/wat-tools/common.wat")

  ;; Whether a `YYYY-MM-DD` or `YYYY/MM/DD` date starts at $p.
  (func $beancountIsDate (param $p i32) (result i32)
    (local $i i32)
    (local $c i32)
    (if (i32.gt_u (i32.add (local.get $p) (i32.const 10)) (global.get $end))
      (then (return (i32.const 0))))
    (block $no
      (loop $l
        (local.set $c (i32.load8_u (i32.add (local.get $p) (local.get $i))))
        (if (i32.or (i32.eq (local.get $i) (i32.const 4)) (i32.eq (local.get $i) (i32.const 7)))
          (then
            (br_if $no
              (i32.and (i32.ne (local.get $c) (i32.const "-")) (i32.ne (local.get $c) (i32.const "/")))))
          (else (br_if $no (i32.eqz (call $lexIsDigit (local.get $c))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $l (i32.lt_u (local.get $i) (i32.const 10))))
      (return (i32.eqz (call $lexIsIdentContinue (call $templateByte (i32.add (local.get $p) (i32.const 10)))))))
    (i32.const 0))

  ;; Whether the word at $p starts its line or follows the line's date, where
  ;; directives and transaction or posting flags stand.
  (func $beancountLead (param $p i32) (result i32)
    (local $c i32)
    (block $back
      (loop $blank
        (br_if $back (i32.le_u (local.get $p) (global.get $srcBase)))
        (local.set $c (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))
        (br_if $back (i32.eqz (byteset.get " \t" (local.get $c))))
        (local.set $p (i32.sub (local.get $p) (i32.const 1)))
        (br $blank)))
    (i32.or
      (i32.or
        (i32.le_u (local.get $p) (global.get $srcBase))
        (byteset.get "\n\r" (local.get $c)))
      (i32.and
        (i32.ge_u (local.get $p) (i32.add (global.get $srcBase) (i32.const 10)))
        (call $beancountIsDate (i32.sub (local.get $p) (i32.const 10))))))

  ;; Beancount ledgers: dated directives (`2024-01-31 open Assets:Cash USD`),
  ;; transactions with flags, payee and narration strings, and indented
  ;; postings, undated `option`/`plugin`/`include`/`pushtag` lines, `;`
  ;; comments, and org-mode `*` headings. Classified by shape, without
  ;; keyword tables: a lowercase word at the line start or after a date is a
  ;; directive, one before `:` is a metadata key, a capitalized word with `:`
  ;; is an account, and other capitalized words are currencies.
  (func $hlBeancount
    (local $c i32)
    (local $gap i32)
    (local $lhs i32)
    (local $p i32)
    (local $hl i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (local.set $hl (enum.get $Token.none))
        (block $emit
          (if (i32.eq (local.get $c) (i32.const ";"))
            (then
              (call $scanToLineEnd)
              (local.set $hl (enum.get $Token.comment))
              (br $emit)))
          (if (i32.eq (local.get $c) (i32.const 34))
            (then
              (global.set $ptr (local.get $lhs))
              (call $lexString (i32.const 34) (i32.const 1) (enum.get $Token.string))
              (br $next)))
          ;; an org-mode heading at the line start
          (if
            (i32.and
              (i32.eq (local.get $c) (i32.const "*"))
              (i32.or
                (i32.eq (local.get $lhs) (global.get $srcBase))
                (i32.le_u (i32.sub (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))) (i32.const 10)) (i32.const 3))))
            (then
              (call $scanToLineEnd)
              (local.set $hl (enum.get $Token.title))
              (br $emit)))
          (if
            (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and
                (i32.or (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c) (i32.const "+")))
                (call $lexIsDigit (call $templateByte (global.get $ptr)))))
            (then
              (local.set $hl (enum.get $Token.number))
              (if (call $beancountIsDate (local.get $lhs))
                (then
                  (global.set $ptr (i32.add (local.get $lhs) (i32.const 10)))
                  (br $emit)))
              ;; digits with `,` thousands separators and a `.` fraction
              (block $numberDone
                (loop $number
                  (local.set $c (call $templateByte (global.get $ptr)))
                  (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ".")))
                    (then
                      (br_if $numberDone
                        (i32.eqz
                          (call $lexIsDigit (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))))
                      (local.set $c (i32.const "0"))))
                  (br_if $numberDone (i32.eqz (call $lexIsDigit (local.get $c))))
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (br $number)))
              (br $emit)))
          (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
            (then
              ;; currencies may hold `'._-`; accounts are `:` paths
              (local.set $hl (enum.get $Token.type))
              (block $wordDone
                (loop $word
                  (call $scanIdentRun (i32.const ":"))
                  (local.set $c (call $templateByte (global.get $ptr)))
                  (br_if $wordDone
                    (i32.eqz
                      (i32.or
                        (i32.or (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c) (i32.const ".")))
                        (i32.eq (local.get $c) (i32.const 39)))))
                  (br_if $wordDone
                    (i32.eqz
                      (call $lexIsIdentContinue (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))))
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                  (br $word)))
              (if
                (i32.lt_u
                  (call $scanFindSpecial (local.get $lhs) (global.get $ptr) (i32.const ":") (i32.const 0) (i32.const 0))
                  (global.get $ptr))
                (then (local.set $hl (enum.get $Token.variable))))
              (local.set $p (i32.sub (global.get $ptr) (local.get $lhs)))
              (if
                (i32.or
                  (i32.and
                    (i32.eq (local.get $p) (i32.const 4))
                    (i32.eq (i32.load (local.get $lhs)) (i32.const "TRUE")))
                  (i32.and
                    (i32.eq (local.get $p) (i32.const 5))
                    (i32.and
                      (i32.eq (i32.load (local.get $lhs)) (i32.const "FALS"))
                      (i32.eq (i32.load8_u offset=4 (local.get $lhs)) (i32.const "E")))))
                (then (local.set $hl (enum.get $Token.boolean))))
              (if
                (i32.and
                  (i32.eq (local.get $p) (i32.const 4))
                  (i32.eq (i32.load (local.get $lhs)) (i32.const "NULL")))
                (then (local.set $hl (enum.get $Token.constant.builtin))))
              (br $emit)))
          (if (i32.le_u (i32.sub (local.get $c) (i32.const "a")) (i32.const 25))
            (then
              (call $scanIdentRun (i32.const "-"))
              (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const ":"))
                (then
                  (call $emitTok (enum.get $Token.property) (local.get $lhs) (global.get $ptr))
                  (local.set $lhs (global.get $ptr))
                  (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                  (local.set $hl (enum.get $Token.punctuation.delimiter))
                  (br $emit)))
              (if (call $beancountLead (local.get $lhs))
                (then (local.set $hl (enum.get $Token.keyword))))
              (br $emit)))
          ;; flags, tags, links, prices, costs, and arithmetic
          (if
            (i32.and
              (i32.or (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $c) (i32.const "!")))
              (call $beancountLead (local.get $lhs)))
            (then
              (local.set $hl (enum.get $Token.keyword))
              (br $emit)))
          (if (i32.or (i32.eq (local.get $c) (i32.const "#")) (i32.eq (local.get $c) (i32.const "^")))
            (then
              (call $scanIdentRun (i32.const "-"))
              (local.set $hl
                (select (enum.get $Token.label) (enum.get $Token.string.special) (i32.eq (local.get $c) (i32.const "#"))))
              (br $emit)))
          (if (byteset.get "()[]{}" (local.get $c))
            (then
              (local.set $hl (enum.get $Token.punctuation.bracket))
              (br $emit)))
          (if (i32.eq (local.get $c) (i32.const ","))
            (then
              (local.set $hl (enum.get $Token.punctuation.delimiter))
              (br $emit)))
          (if (byteset.get "!%&*+-/<=>?^|~" (local.get $c))
            (then
              (local.set $hl (enum.get $Token.operator))
              (br $emit)))
          (if (i32.eq (local.get $c) (i32.const "@"))
            (then
              (global.set $ptr
                (i32.add
                  (global.get $ptr)
                  (i32.eq (call $templateByte (global.get $ptr)) (i32.const "@"))))
              (local.set $hl (enum.get $Token.operator))
              (br $emit)))
          (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
