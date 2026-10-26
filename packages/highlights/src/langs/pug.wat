(module
  (import "../common.wat")
  (import "./haml.wat")

  ;; Token in the low byte. Bit 8: `mixin`. Bit 9: `each`/`for`, names before
  ;; `in`. Bit 10: the rest of the line is a path or block name. Others take a JS
  ;; expression.
  (keyword-table $pugWords $mem.pugWords $mem.coffeeWords
    (group $Token.keyword.import+1024 "include" "extends")
    (group $Token.keyword.declaration+1024 "block" "append" "prepend")
    (group $Token.keyword.declaration+256 "mixin")
    (group $Token.keyword.control+512 "each" "for")
    (group $Token.keyword.control
      "if" "case" "else" "when" "while" "yield" "unless" "default")
    (group $Token.tag.doctype "doctype"))

  ;; WARNING: nested `#[tag]` and `tag: tag` depth. Past 8 the rest stays text, so
  ;; input cannot exhaust the call stack. Every caller restores it.
  (global $pugNest (mut i32) (i32.const 0))

  (func $pugJs (param $stop i32)
    (local $save i32)
    (local.set $save (global.get $end))
    (global.set $end (local.get $stop))
    (call $hlJs)
    (call $ecmaReset)
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $stop)))

  ;; A `,` or `)` outside brackets and quotes, or a blank no operator joins.
  (func $pugValueEnd (param $p i32) (param $stop i32) (result i32)
    (local $c i32)
    (local $depth i32)
    (local $q i32)
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (local.get $p) (local.get $stop)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.or (i32.eq (local.get $c) (i32.const 39)) (i32.eq (local.get $c) (i32.const "`"))))
          (then
            (loop $str
              (local.set $p (i32.add (local.get $p) (i32.const 1)))
              (if (i32.lt_u (local.get $p) (local.get $stop))
                (then
                  (local.set $q (i32.load8_u (local.get $p)))
                  (if (i32.eq (local.get $q) (i32.const 92))
                    (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
                  (br_if $str (i32.ne (local.get $q) (local.get $c))))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $scan)))
        (if (byteset.get "([{" (local.get $c))
          (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
        (if (byteset.get ")]}" (local.get $c))
          (then
            (br_if $done (i32.eqz (local.get $depth)))
            (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))))
        (if (i32.eqz (local.get $depth))
          (then
            (br_if $done (i32.eq (local.get $c) (i32.const ",")))
            (if (i32.or (i32.eq (local.get $c) (i32.const 32)) (i32.eq (local.get $c) (i32.const 9)))
              (then
                (local.set $q (call $lexSkipSpaceAt (local.get $p)))
                (local.set $c (call $templateByte (local.get $q)))
                (br_if $done (i32.ge_u (local.get $q) (local.get $stop)))
                (if (i32.eqz (byteset.get "!%&*+-/<=>?^|~" (local.get $c)))
                  (then
                    (local.set $c (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))
                    (br_if $done (i32.eqz (byteset.get "!%&*+-/<=>?^|~" (local.get $c))))))
                (local.set $p (local.get $q))
                (br $scan)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (select (local.get $stop) (local.get $p) (i32.gt_u (local.get $p) (local.get $stop))))

  ;; Returns 0 after the `)`, -1 when the list runs past $stop.
  (func $pugAttrs (param $stop i32) (result i32)
    (local $c i32)
    (local $lhs i32)
    (block $done
      (result i32)
      (loop $attr
        (result i32)
        (local.set $lhs (global.get $ptr))
        (global.set $ptr (call $lexSkipSpaceAt (global.get $ptr)))
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.const -1) (i32.ge_u (global.get $ptr) (local.get $stop)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (if (i32.eq (local.get $c) (i32.const ")"))
          (then
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $done (i32.const 0))))
        (if (i32.eq (local.get $c) (i32.const ","))
          (then
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $attr)))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const "="))
            (i32.and (i32.eq (local.get $c) (i32.const "!")) (i32.eq (call $templateByte (global.get $ptr)) (i32.const "="))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.eq (local.get $c) (i32.const "!"))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $lhs (global.get $ptr))
            (global.set $ptr (call $lexSkipSpaceAt (global.get $ptr)))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (call $pugJs (call $pugValueEnd (global.get $ptr) (local.get $stop)))
            (br $attr)))
        (block $nameDone
          (loop $name
            (br_if $nameDone (i32.ge_u (global.get $ptr) (local.get $stop)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $nameDone (byteset.get "\00\09\0a\0b\0c\0d \22'(),;[]`{}" (local.get $c)))
            (br_if $nameDone (i32.eq (local.get $c) (i32.const "=")))
            (br_if $nameDone
              (i32.and
                (i32.eq (local.get $c) (i32.const "!"))
                (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "="))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $name)))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (local.get $stop)))
        (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
        (br $attr))))

  (func $pugText (param $stop i32)
    (local $c i32)
    (local $close i32)
    (local $p i32)
    (local $save i32)
    (local $seg i32)
    (local.set $save (global.get $end))
    (global.set $end (local.get $stop))
    (local.set $seg (global.get $ptr))
    (local.set $p (global.get $ptr))
    (block $done
      (loop $scan
        (local.set $p (call $lexFindEither (local.get $p) (i32.const "#") (i32.const "!")))
        (br_if $done (i32.ge_u (local.get $p) (local.get $stop)))
        (local.set $c (call $templateByte (i32.add (local.get $p) (i32.const 1))))
        (if
          (i32.or
            (i32.eqz
              (i32.or
                (i32.eq (local.get $c) (i32.const "{"))
                (i32.and
                  (i32.eq (local.get $c) (i32.const "["))
                  (i32.and
                    (i32.eq (i32.load8_u (local.get $p)) (i32.const "#"))
                    (i32.lt_u (global.get $pugNest) (i32.const 8))))))
            (i32.and
              (i32.gt_u (local.get $p) (local.get $seg))
              (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const 92))))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $scan)))
        (call $emitTok (enum.get $Token.none) (local.get $seg) (local.get $p))
        (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
        (call $emitTok (enum.get $Token.punctuation.special) (local.get $p) (global.get $ptr))
        (local.set $p (global.get $ptr))
        (local.set $close (call $hamlMatch (i32.const 1) (local.get $c) (local.get $stop)))
        (local.set $close
          (select (local.get $stop) (i32.sub (global.get $ptr) (i32.const 1)) (local.get $close)))
        (global.set $ptr (local.get $p))
        (if (i32.eq (local.get $c) (i32.const "{"))
          (then (call $pugJs (local.get $close)))
          (else
            (global.set $pugNest (i32.add (global.get $pugNest) (i32.const 1)))
            (drop (call $pugTag (local.get $close)))
            (global.set $pugNest (i32.sub (global.get $pugNest) (i32.const 1)))
            (call $emitTok (enum.get $Token.none) (global.get $ptr) (local.get $close))))
        (global.set $ptr (local.get $close))
        (if (i32.lt_u (local.get $close) (local.get $stop))
          (then
            (global.set $ptr (i32.add (local.get $close) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $close) (global.get $ptr))))
        (local.set $seg (global.get $ptr))
        (local.set $p (global.get $ptr))
        (br $scan)))
    (call $emitTok (enum.get $Token.none) (local.get $seg) (local.get $stop))
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $stop)))

  ;; A `script` or `style` name gives its dotted block a language.
  (func $pugTag (param $stop i32) (result i32)
    (local $c i32)
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (block $nameDone
      (loop $name
        (br_if $nameDone (i32.ge_u (global.get $ptr) (local.get $stop)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (br_if $nameDone
          (i32.eqz
            (i32.or
              (i32.and (call $lexIsIdentContinue (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
              (i32.or
                (i32.eq (local.get $c) (i32.const "-"))
                (i32.and
                  (i32.eq (local.get $c) (i32.const ":"))
                  (call $lexIsIdentStart (call $templateByte (i32.add (global.get $ptr) (i32.const 1)))))))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $name)))
    (call $emitTok (enum.get $Token.tag) (local.get $lhs) (global.get $ptr))
    (local.set $c (call $indentFilterKind (local.get $lhs) (global.get $ptr)))
    (call $pugTail (local.get $stop) (select (local.get $c) (i32.const 0) (i32.le_u (local.get $c) (i32.const 2)))))

  ;; Returns 0x200 | $kind when the attributes run past $stop, 0x100 | $kind for
  ;; a dotted block, else 0.
  (func $pugTail (param $stop i32) (param $kind i32) (result i32)
    (local $c i32)
    (local $hl i32)
    (local $lhs i32)
    (block $content
      (loop $part
        (br_if $content (i32.ge_u (global.get $ptr) (local.get $stop)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $hl
          (select
            (enum.get $Token.selector.class)
            (enum.get $Token.selector.id)
            (i32.eq (local.get $c) (i32.const "."))))
        (if
          (i32.and
            (i32.or (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c) (i32.const "#")))
            (i32.or
              (call $lexIsIdentStart (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
              (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 1))) (i32.const "-"))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (block $nameDone
              (loop $name
                (local.set $c (call $templateByte (global.get $ptr)))
                (br_if $nameDone (i32.ge_u (global.get $ptr) (local.get $stop)))
                (br_if $nameDone
                  (i32.eqz
                    (i32.or
                      (i32.and (call $lexIsIdentContinue (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
                      (i32.eq (local.get $c) (i32.const "-")))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $name)))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $part)))
        (if (i32.eq (local.get $c) (i32.const "("))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br_if $part (i32.eqz (call $pugAttrs (local.get $stop))))
            (return (i32.or (i32.const 0x200) (local.get $kind)))))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "&"))
            (i32.and
              (i32.le_u (i32.add (local.get $lhs) (i32.const 11)) (local.get $stop))
              (i32.and
                (i64.eq (i64.load offset=1 (local.get $lhs)) (i64.const "attribut"))
                (i32.eq (i32.load16_u offset=9 (local.get $lhs)) (i32.const "es")))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 11)))
            (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (global.get $ptr))
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "("))
              (then
                (local.set $lhs (global.get $ptr))
                (drop (call $hamlMatch (i32.const 0) (i32.const "(") (local.get $stop)))
                (local.set $c (global.get $ptr))
                (global.set $ptr (local.get $lhs))
                (call $pugJs (local.get $c))))
            (br $part)))
        (br $content)))
    (local.set $lhs (global.get $ptr))
    (local.set $c (call $templateByte (local.get $lhs)))
    (if
      (i32.and
        (i32.eq (local.get $c) (i32.const "."))
        (i32.ge_u (call $lexSkipSpaceAt (i32.add (local.get $lhs) (i32.const 1))) (local.get $stop)))
      (then
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
        (return (i32.or (i32.const 0x100) (local.get $kind)))))
    (if
      (i32.and
        (i32.and
          (i32.eq (local.get $c) (i32.const ":"))
          (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 1))) (i32.const 32)))
        (i32.lt_u (global.get $pugNest) (i32.const 8)))
      (then
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
        (local.set $lhs (global.get $ptr))
        (global.set $ptr (call $lexSkipSpaceAt (global.get $ptr)))
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (global.set $pugNest (i32.add (global.get $pugNest) (i32.const 1)))
        (local.set $c (call $pugLine (local.get $stop)))
        (global.set $pugNest (i32.sub (global.get $pugNest) (i32.const 1)))
        (return (local.get $c))))
    (if
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "=")) (i32.eq (local.get $c) (i32.const "/")))
        (i32.and
          (i32.eq (local.get $c) (i32.const "!"))
          (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 1))) (i32.const "="))))
      (then
        (global.set $ptr
          (i32.add (local.get $lhs) (i32.add (i32.const 1) (i32.eq (local.get $c) (i32.const "!")))))
        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
        (call $pugJs (local.get $stop))
        (return (i32.const 0))))
    (call $pugText (local.get $stop))
    (i32.const 0))

  ;; Returns what $pugTail returns, 0x400 | the language of a filter or code
  ;; block, or 0x800 for a comment.
  (func $pugLine (param $stop i32) (result i32)
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $p i32)
    (local $v i32)
    (local.set $lhs (global.get $ptr))
    (local.set $c (call $templateByte (local.get $lhs)))
    (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
    (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
      (then
        (global.set $ptr (local.get $stop))
        (call $emitTok (enum.get $Token.comment) (local.get $lhs) (local.get $stop))
        (return (i32.const 0x800))))
    (if (i32.eq (local.get $c) (i32.const "|"))
      (then
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
        (call $pugText (local.get $stop))
        (return (i32.const 0))))
    (if (i32.eq (local.get $c) (i32.const "<"))
      (then
        (global.set $ptr (local.get $stop))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (local.get $stop))
        (return (i32.const 0))))
    (if (i32.eq (local.get $c) (i32.const "-"))
      (then
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
        (if (i32.ge_u (call $lexSkipSpaceAt (global.get $ptr)) (local.get $stop))
          (then (return (i32.const 0x401))))
        (call $pugJs (local.get $stop))
        (return (i32.const 0))))
    (if
      (i32.or
        (i32.eq (local.get $c) (i32.const "="))
        (i32.and (i32.eq (local.get $c) (i32.const "!")) (i32.eq (local.get $c2) (i32.const "="))))
      (then (return (call $pugTail (local.get $stop) (i32.const 0)))))
    (if (i32.and (i32.eq (local.get $c) (i32.const "+")) (call $lexIsIdentStart (local.get $c2)))
      (then
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (call $scanIdentRun (i32.const "-"))
        (call $emitTok (enum.get $Token.function) (local.get $lhs) (global.get $ptr))
        (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "("))
          (then
            (local.set $lhs (global.get $ptr))
            (drop (call $hamlMatch (i32.const 0) (i32.const "(") (local.get $stop)))
            (local.set $p (global.get $ptr))
            (global.set $ptr (local.get $lhs))
            (call $pugJs (local.get $p))))
        (return (call $pugTail (local.get $stop) (i32.const 0)))))
    (if (i32.and (i32.eq (local.get $c) (i32.const ":")) (call $lexIsIdentStart (local.get $c2)))
      (then
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (call $scanIdentRun (i32.const "-"))
        (local.set $v (call $indentFilterKind (i32.add (local.get $lhs) (i32.const 1)) (global.get $ptr)))
        (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (global.get $ptr))
        (call $emitTok (enum.get $Token.none) (global.get $ptr) (local.get $stop))
        (global.set $ptr (local.get $stop))
        (return (i32.or (i32.const 0x400) (select (i32.const 0) (local.get $v) (i32.eq (local.get $v) (i32.const 6)))))))
    (if (i32.eqz (call $lexIsIdentStart (local.get $c)))
      (then
        (if
          (i32.eqz
            (i32.and
              (i32.or (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c) (i32.const "#")))
              (i32.or (call $lexIsIdentStart (local.get $c2)) (i32.eq (local.get $c2) (i32.const "-")))))
          (then
            (call $pugText (local.get $stop))
            (return (i32.const 0))))
        (return (call $pugTail (local.get $stop) (i32.const 0)))))
    (call $scanIdentRun (i32.const "-"))
    (local.set $v (keyword-table.value $pugWords (local.get $lhs) (global.get $ptr)))
    (if (i32.eq (local.get $v) (i32.const -1))
      (then
        (global.set $ptr (local.get $lhs))
        (return (call $pugTag (local.get $stop)))))
    (call $emitTok (i32.and (local.get $v) (i32.const 255)) (local.get $lhs) (global.get $ptr))
    (if (i32.eq (i32.and (local.get $v) (i32.const 255)) (enum.get $Token.tag.doctype))
      (then
        (call $emitTok (enum.get $Token.tag.doctype) (global.get $ptr) (local.get $stop))
        (global.set $ptr (local.get $stop))
        (return (i32.const 0))))
    (if (i32.and (local.get $v) (i32.const 1024))
      (then
        (local.set $c (i32.eq (i32.and (local.get $v) (i32.const 255)) (enum.get $Token.keyword.import)))
        (block $wordsDone
          (loop $word
            (local.set $lhs (global.get $ptr))
            (global.set $ptr (call $lexSkipSpaceAt (global.get $ptr)))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (br_if $wordsDone (i32.ge_u (global.get $ptr) (local.get $stop)))
            (local.set $lhs (global.get $ptr))
            (if (i32.eq (i32.load8_u (local.get $lhs)) (i32.const ":"))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $scanIdentRun (i32.const "-"))
                (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (global.get $ptr))
                (br $word)))
            (if (local.get $c)
              (then
                (global.set $ptr (local.get $stop))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (local.get $stop))
                (br $wordsDone)))
            (call $scanIdentRun (i32.const "-"))
            (global.set $ptr
              (call $utf8SpanEnd
                (select
                  (global.get $ptr)
                  (i32.add (local.get $lhs) (i32.const 1))
                  (i32.gt_u (global.get $ptr) (local.get $lhs)))
                (local.get $stop)))
            (call $emitTok
              (select
                (enum.get $Token.keyword.declaration)
                (enum.get $Token.variable)
                (i32.eq
                  (keyword-table.value $pugWords (local.get $lhs) (global.get $ptr))
                  (i32.or (enum.get $Token.keyword.declaration) (i32.const 1024))))
              (local.get $lhs)
              (global.get $ptr))
            (br $word)))
        (return (i32.const 0))))
    (if (i32.and (local.get $v) (i32.const 256))
      (then
        (local.set $lhs (global.get $ptr))
        (global.set $ptr (call $lexSkipSpaceAt (global.get $ptr)))
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (local.set $lhs (global.get $ptr))
        (call $scanIdentRun (i32.const "-"))
        (call $emitTok (enum.get $Token.function.definition) (local.get $lhs) (global.get $ptr))
        (block $paramsDone
          (loop $param
            (br_if $paramsDone (i32.ge_u (global.get $ptr) (local.get $stop)))
            (local.set $lhs (global.get $ptr))
            (local.set $c (i32.load8_u (local.get $lhs)))
            (if (call $lexIsIdentStart (local.get $c))
              (then
                (call $lexScanIdent)
                (call $emitTok (enum.get $Token.variable.parameter) (local.get $lhs) (global.get $ptr))
                (br $param)))
            (if (i32.eq (local.get $c) (i32.const "="))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (local.set $lhs (global.get $ptr))
                (global.set $ptr (call $lexSkipSpaceAt (global.get $ptr)))
                (call $emitGap (local.get $lhs) (global.get $ptr))
                (call $pugJs (call $pugValueEnd (global.get $ptr) (local.get $stop)))
                (br $param)))
            (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 1)) (local.get $stop)))
            (if (call $lexIsSpace (local.get $c))
              (then (call $emitGap (local.get $lhs) (global.get $ptr)))
              (else
                (call $emitTok
                  (select
                    (enum.get $Token.punctuation.bracket)
                    (select (enum.get $Token.punctuation.delimiter) (enum.get $Token.operator) (i32.eq (local.get $c) (i32.const ",")))
                    (byteset.get "()[]{}" (local.get $c)))
                  (local.get $lhs)
                  (global.get $ptr))))
            (br $param)))
        (return (i32.const 0))))
    (if (i32.and (local.get $v) (i32.const 512))
      (then
        (block $namesDone
          (loop $names
            (local.set $lhs (global.get $ptr))
            (global.set $ptr (call $lexSkipSpaceAt (global.get $ptr)))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (br_if $namesDone (i32.ge_u (global.get $ptr) (local.get $stop)))
            (local.set $lhs (global.get $ptr))
            (if (i32.eq (i32.load8_u (local.get $lhs)) (i32.const ","))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
                (br $names)))
            (br_if $namesDone (i32.eqz (call $lexIsIdentStart (i32.load8_u (local.get $lhs)))))
            (call $lexScanIdent)
            (if
              (i32.and
                (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 2))
                (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "in")))
              (then
                (call $emitTok (enum.get $Token.keyword.control) (local.get $lhs) (global.get $ptr))
                (br $namesDone)))
            (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
            (br $names)))))
    (call $pugJs (local.get $stop))
    (i32.const 0))

  ;; $block: an indented comment or text block, 128 | 1 comment or 2 text | the
  ;; head line's indentation << 8. $tag: 0x200 | the block language of a tag whose
  ;; attributes run past its line. Both are 0 while an embedded body is open.
  (func $hlPug
    (local $indent i32)
    (local $kind i32)
    (local $lhs i32)
    (local $lineEnd i32)
    (local $block i32)
    (local $tag i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $line
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (global.set $ptr (call $lexSkipSpaceAt (local.get $lhs)))
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (local.set $indent (i32.sub (global.get $ptr) (local.get $lhs)))
        (local.set $lhs (global.get $ptr))
        (local.set $lineEnd (call $indentLineEnd (local.get $lhs)))
        (local.set $kind (i32.const 0))
        (block $rest
          (br_if $rest (i32.eq (local.get $lhs) (local.get $lineEnd)))
          (if (local.get $block)
            (then
              (if (i32.gt_u (local.get $indent) (i32.shr_u (local.get $block) (i32.const 8)))
                (then
                  (if (i32.and (local.get $block) (i32.const 1))
                    (then
                      (global.set $ptr (local.get $lineEnd))
                      (call $emitTok (enum.get $Token.comment) (local.get $lhs) (local.get $lineEnd)))
                    (else (call $pugText (local.get $lineEnd))))
                  (br $rest)))
              (local.set $block (i32.const 0))))
          (if (local.get $tag)
            (then
              (br_if $rest (call $pugAttrs (local.get $lineEnd)))
              (local.set $kind (call $pugTail (local.get $lineEnd) (i32.and (local.get $tag) (i32.const 255))))
              (local.set $tag (i32.const 0)))
            (else (local.set $kind (call $pugLine (local.get $lineEnd)))))
          (if (i32.and (local.get $kind) (i32.const 0x200))
            (then
              (local.set $tag (local.get $kind))
              (local.set $kind (i32.const 0)))))
        (call $emitTok (enum.get $Token.none) (global.get $ptr) (local.get $lineEnd))
        (global.set $ptr (call $indentAfterBreak (local.get $lineEnd)))
        (call $emitGap (local.get $lineEnd) (global.get $ptr))
        (if (local.get $kind)
          (then
            (if (i32.eq (local.get $kind) (i32.const 0x800))
              (then (local.set $block (i32.or (i32.const 0x81) (i32.shl (local.get $indent) (i32.const 8)))))
              (else
                (local.set $kind (i32.and (local.get $kind) (i32.const 255)))
                (if (local.get $kind)
                  (then (drop (call $indentBody (local.get $kind) (local.get $indent) (i32.const 0))))
                  (else (local.set $block (i32.or (i32.const 0x82) (i32.shl (local.get $indent) (i32.const 8))))))))))
        (br $line))))
)
