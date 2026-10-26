(module
  (import "../common.wat")
  (import "./ruby.wat")
  (import "./coffee.wat")
  (import "./css.wat")

  ;; Haml and Pug share these indented blocks. A body kind is 1 JavaScript, 2-5
  ;; CSS dialects (2 + the css.wat dialect), 6 Ruby, 7 CoffeeScript. A body cut by
  ;; a chunk end is stream region 28 with `indent | kind << 16` in $streamC.

  (func $indentLineEnd (param $p i32) (result i32)
    (call $scanFindSpecial (local.get $p) (global.get $end) (i32.const 10) (i32.const 0) (i32.const 1)))

  (func $indentAfterBreak (param $p i32) (result i32)
    (if (i32.ge_u (local.get $p) (global.get $end))
      (then (return (local.get $p))))
    (if
      (i32.and
        (i32.eq (i32.load8_u (local.get $p)) (i32.const 13))
        (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const 10)))
      (then (return (i32.add (local.get $p) (i32.const 2)))))
    (i32.add (local.get $p) (i32.const 1)))

  ;; The first line at or after $p that is not blank and is indented $indent
  ;; bytes or less, or $end.
  (func $indentBlockEnd (param $p i32) (param $indent i32) (result i32)
    (local $c i32)
    (local $q i32)
    (block $done
      (loop $line
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $q (call $lexSkipSpaceAt (local.get $p)))
        (local.set $c (call $templateByte (local.get $q)))
        (br_if $done
          (i32.and
            (i32.le_u (i32.sub (local.get $q) (local.get $p)) (local.get $indent))
            (i32.and
              (i32.lt_u (local.get $q) (global.get $end))
              (i32.eqz (byteset.get "\n\r" (local.get $c))))))
        (local.set $p (call $indentAfterBreak (call $indentLineEnd (local.get $q))))
        (br $line)))
    (local.get $p))

  (func $indentFilterKind (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local $w i64)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.gt_u (i32.sub (local.get $n) (i32.const 2)) (i32.const 10))
      (then (return (i32.const 0))))
    ;; the wide loads stay inside the input slack; the mask drops bytes past $rhs
    (local.set $w
      (i64.and
        (i64.load (local.get $lhs))
        (select
          (i64.const -1)
          (i64.sub (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $n) (i32.const 3)))) (i64.const 1))
          (i32.ge_u (local.get $n) (i32.const 8)))))
    (if
      (i32.or
        (i32.or
          (i64.eq (local.get $w) (i64.const "js"))
          (i64.eq (local.get $w) (i64.const "script")))
        (i32.and
          (i32.eq (local.get $n) (i32.const 10))
          (i64.eq (local.get $w) (i64.const "javascri"))))
      (then (return (i32.const 1))))
    (if (i32.or (i64.eq (local.get $w) (i64.const "css")) (i64.eq (local.get $w) (i64.const "style")))
      (then (return (i32.const 2))))
    (if (i64.eq (local.get $w) (i64.const "less"))
      (then (return (i32.const 3))))
    (if (i64.eq (local.get $w) (i64.const "scss"))
      (then (return (i32.const 4))))
    (if (i64.eq (local.get $w) (i64.const "sass"))
      (then (return (i32.const 5))))
    (if (i64.eq (local.get $w) (i64.const "ruby"))
      (then (return (i32.const 6))))
    (if
      (i32.or
        (i64.eq (local.get $w) (i64.const "coffee"))
        (i32.and
          (i32.eq (local.get $n) (i32.const 12))
          (i64.eq (local.get $w) (i64.const "coffeesc"))))
      (then (return (i32.const 7))))
    (i32.const 0))

  ;; Returns 1 when the body runs to the chunk end and saved region 28.
  (func $indentBody (param $kind i32) (param $indent i32) (param $resume i32) (result i32)
    (local $open i32)
    (local $root i32)
    (local $save i32)
    (local $saveDepth i32)
    (local $saveReset i32)
    (local $to i32)
    (local.set $to (call $indentBlockEnd (global.get $ptr) (local.get $indent)))
    (local.set $open (i32.and (global.get $streaming) (i32.eq (local.get $to) (global.get $eof))))
    (local.set $root (i32.and (global.get $streaming) (i32.or (local.get $open) (local.get $resume))))
    (local.set $save (global.get $end))
    (local.set $saveDepth (global.get $streamDepth))
    (local.set $saveReset (global.get $streamReset))
    (global.set $end (local.get $to))
    (if (local.get $root)
      (then
        (global.set $streamDepth (i32.const 0))
        (global.set $streamReset (i32.eqz (local.get $resume)))))
    (block $body
      ;; a resumed body first finishes the comment or string its lexer left
      (if (i32.and (local.get $resume) (i32.ne (local.get $kind) (i32.const 1)))
        (then (br_if $body (call $streamResumeCommon))))
      (if (i32.eq (local.get $kind) (i32.const 1))
        (then
          (if (local.get $root)
            (then (call $hlJsStream (i32.eqz (local.get $resume))))
            (else (call $hlJs)))
          (br $body)))
      (if (i32.eq (local.get $kind) (i32.const 6))
        (then
          (call $hlRuby)
          (br $body)))
      (if (i32.eq (local.get $kind) (i32.const 7))
        (then
          (call $hlCoffee)
          (br $body)))
      (global.set $cssDialect (i32.sub (local.get $kind) (i32.const 2)))
      (drop (call $hlCssImpl (i32.const 0))))
    (global.set $end (local.get $save))
    (global.set $streamDepth (local.get $saveDepth))
    (global.set $streamReset (local.get $saveReset))
    (global.set $ptr (local.get $to))
    (if (i32.and (i32.eq (local.get $kind) (i32.const 1)) (i32.eqz (local.get $open)))
      (then (call $ecmaReset)))
    (if (local.get $open)
      (then
        (call $streamSetRegion (i32.const 28))
        (global.set $streamC (i32.or (local.get $indent) (i32.shl (local.get $kind) (i32.const 16))))))
    (local.get $open))

  (func $indentStreamResume (result i32)
    (if
      (call $indentBody
        (i32.shr_u (global.get $streamC) (i32.const 16))
        (i32.and (global.get $streamC) (i32.const 0xffff))
        (i32.const 1))
      (then (return (i32.const 1))))
    (global.set $streamRegionKind (i32.const 0))
    (global.set $streamMode (i32.const 0))
    (global.set $streamC (i32.const 0))
    (call $streamClearCheckpoints)
    (i32.ge_u (global.get $ptr) (global.get $end)))


  (func $hamlRuby (param $stop i32)
    (local $save i32)
    (local.set $save (global.get $end))
    (global.set $end (local.get $stop))
    (call $hlRuby)
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $stop)))

  ;; Returns the depth still open at $stop.
  (func $hamlMatch (param $depth i32) (param $open i32) (param $stop i32) (result i32)
    (local $b i32)
    (local $c i32)
    (local $close i32)
    ;; `)` follows `(`; `]` and `}` sit two after `[` and `{`
    (local.set $close
      (i32.add (local.get $open) (i32.add (i32.const 1) (i32.ne (local.get $open) (i32.const "(")))))
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (global.get $ptr) (local.get $stop)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (if (i32.eq (local.get $c) (local.get $open))
          (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
        (if (i32.eq (local.get $c) (local.get $close))
          (then
            (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
            (br_if $done (i32.eqz (local.get $depth)))))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (block $quoted
              (loop $str
                (br_if $quoted (i32.ge_u (global.get $ptr) (local.get $stop)))
                (local.set $b (i32.load8_u (global.get $ptr)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br_if $quoted (i32.eq (local.get $b) (local.get $c)))
                (if (i32.eq (local.get $b) (i32.const 92))
                  (then
                    (global.set $ptr
                      (select
                        (local.get $stop)
                        (i32.add (global.get $ptr) (i32.const 1))
                        (i32.ge_u (global.get $ptr) (local.get $stop))))))
                (br $str)))))
        (br $scan)))
    (local.get $depth))

  (func $hamlText (param $stop i32)
    (local $lhs i32)
    (local $p i32)
    (local $save i32)
    (local.set $save (global.get $end))
    (global.set $end (local.get $stop))
    (local.set $lhs (global.get $ptr))
    (local.set $p (global.get $ptr))
    (block $done
      (loop $scan
        (local.set $p (call $lexFindByte (local.get $p) (i32.const "#")))
        (br_if $done (i32.ge_u (local.get $p) (local.get $stop)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br_if $scan (i32.ne (call $templateByte (local.get $p)) (i32.const "{")))
        (br_if $scan
          (i32.and
            (i32.gt_u (local.get $p) (i32.add (local.get $lhs) (i32.const 1)))
            (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 2))) (i32.const 92))))
        (call $emitTok (enum.get $Token.none) (global.get $ptr) (i32.sub (local.get $p) (i32.const 1)))
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (call $emitTok
          (enum.get $Token.punctuation.special)
          (i32.sub (local.get $p) (i32.const 1))
          (global.get $ptr))
        (local.set $p (global.get $ptr))
        (if (i32.eqz (call $hamlMatch (i32.const 1) (i32.const "{") (local.get $stop)))
          (then
            (local.set $lhs (global.get $ptr))
            (global.set $ptr (local.get $p))
            (call $hamlRuby (i32.sub (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (global.get $ptr) (local.get $lhs))
            (global.set $ptr (local.get $lhs))
            (local.set $p (local.get $lhs))
            (br $scan)))
        (global.set $ptr (local.get $p))
        (call $hamlRuby (local.get $stop))
        (local.set $p (local.get $stop))))
    (call $emitTok (enum.get $Token.none) (global.get $ptr) (local.get $stop))
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $stop)))

  ;; Returns 1 when the last visible byte is a `,`, which continues the code.
  (func $hamlRubyLine (param $stop i32) (result i32)
    (call $hamlRuby (local.get $stop))
    (i32.eq (call $lexLineByteBefore (local.get $stop)) (i32.const ",")))

  ;; Returns 0 after the `)`, -1 when the list runs past $stop.
  (func $hamlParen (param $stop i32) (result i32)
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
        (if (i32.eq (local.get $c) (i32.const "="))
          (then
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $attr)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            ;; an escaped line break must not carry the string past $stop
            (global.set $ptr (local.get $lhs))
            (local.set $lhs (global.get $end))
            (global.set $end (local.get $stop))
            (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (global.set $end (local.get $lhs))
            (br $attr)))
        (block $runDone
          (loop $run
            (local.set $c (call $templateByte (global.get $ptr)))
            (br_if $runDone (i32.ge_u (global.get $ptr) (local.get $stop)))
            (br_if $runDone
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const ")")) (i32.eq (local.get $c) (i32.const "=")))
                (i32.or (i32.eq (local.get $c) (i32.const 32)) (i32.eq (local.get $c) (i32.const 9)))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $run)))
        (if (i32.eq (call $lexLineByteBefore (local.get $lhs)) (i32.const "="))
          (then
            (local.set $c (global.get $ptr))
            (global.set $ptr (local.get $lhs))
            (call $hamlRuby (local.get $c)))
          (else
            (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (local.get $stop)))
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))))
        (br $attr))))

  ;; Returns the depth of a `{` hash open at $stop, -1 for an open `(` list, or
  ;; 1 << 30 when Ruby content ends with a `,`.
  (func $hamlTag (param $stop i32) (result i32)
    (local $c i32)
    (local $depth i32)
    (local $hl i32)
    (local $lhs i32)
    (block $content
      (loop $part
        (br_if $content (i32.ge_u (global.get $ptr) (local.get $stop)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $hl (enum.get $Token.tag))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then (local.set $hl (enum.get $Token.selector.class))))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "#"))
            (i32.ne (call $templateByte (i32.add (local.get $lhs) (i32.const 1))) (i32.const "{")))
          (then (local.set $hl (enum.get $Token.selector.id))))
        (if (i32.or (i32.ne (local.get $hl) (enum.get $Token.tag)) (i32.eq (local.get $c) (i32.const "%")))
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
                      (i32.or
                        (i32.eq (local.get $c) (i32.const "-"))
                        (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $hl) (enum.get $Token.tag)))))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $name)))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $part)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "[")))
          (then
            (local.set $depth (call $hamlMatch (i32.const 0) (local.get $c) (local.get $stop)))
            (local.set $c (global.get $ptr))
            (global.set $ptr (local.get $lhs))
            (call $hamlRuby (local.get $c))
            (if (local.get $depth)
              (then (return (local.get $depth))))
            (br $part)))
        (if (i32.eq (local.get $c) (i32.const "("))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br_if $part (i32.eqz (call $hamlParen (local.get $stop))))
            (return (i32.const -1))))
        (br_if $content
          (i32.eqz
            (i32.or
              (i32.eq (local.get $c) (i32.const "/"))
              (i32.eq (i32.or (local.get $c) (i32.const 2)) (i32.const ">")))))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
        (br $part)))
    (call $hamlContent (local.get $stop)))

  ;; Returns 1 << 30 when the Ruby ends with a `,`.
  (func $hamlContent (param $stop i32) (result i32)
    (local $lhs i32)
    (local $c i32)
    (local.set $lhs (global.get $ptr))
    (local.set $c (call $templateByte (local.get $lhs)))
    (if (i32.or (i32.eq (local.get $c) (i32.const "!")) (i32.eq (local.get $c) (i32.const "&")))
      (then
        (if (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 1))) (i32.const "="))
          (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))))))
    (local.set $c (call $templateByte (global.get $ptr)))
    (if (i32.or (i32.eq (local.get $c) (i32.const "=")) (i32.eq (local.get $c) (i32.const "~")))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "="))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
        (return (i32.shl (call $hamlRubyLine (local.get $stop)) (i32.const 30)))))
    (global.set $ptr (local.get $lhs))
    (call $hamlText (local.get $stop))
    (i32.const 0))

  ;; $block: an indented comment or text block, 128 | its token | the head line's
  ;; indentation << 8. $tag: an open `{` hash depth or `(` list (-1). $cont: 1
  ;; after Ruby that ends with `,`. All are 0 while a filter body is open.
  (func $hlHaml
    (local $c i32)
    (local $indent i32)
    (local $kind i32)
    (local $lhs i32)
    (local $lineEnd i32)
    (local $p i32)
    (local $block i32)
    (local $tag i32)
    (local $cont i32)
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
                  (global.set $ptr (local.get $lineEnd))
                  (call $emitTok (i32.and (local.get $block) (i32.const 127)) (local.get $lhs) (local.get $lineEnd))
                  (br $rest)))
              (local.set $block (i32.const 0))))
          (if (local.get $cont)
            (then
              (local.set $cont (call $hamlRubyLine (local.get $lineEnd)))
              (br $rest)))
          (if (local.get $tag)
            (then
              (if (i32.gt_s (local.get $tag) (i32.const 0))
                (then
                  (local.set $tag (call $hamlMatch (local.get $tag) (i32.const "{") (local.get $lineEnd)))
                  (local.set $p (global.get $ptr))
                  (global.set $ptr (local.get $lhs))
                  (call $hamlRuby (local.get $p)))
                (else (local.set $tag (call $hamlParen (local.get $lineEnd)))))
              (br_if $rest (local.get $tag))
              (local.set $tag (call $hamlTag (local.get $lineEnd)))
              (local.set $cont (i32.eq (local.get $tag) (i32.const 0x40000000)))
              (local.set $tag (select (i32.const 0) (local.get $tag) (local.get $cont)))
              (br $rest)))
          (local.set $c (i32.load8_u (local.get $lhs)))
          (local.set $p (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
          (if
            (i32.and
              (i32.eq (local.get $c) (i32.const "!"))
              (i32.and
                (i32.eq (local.get $p) (i32.const "!"))
                (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "!"))))
            (then
              (global.set $ptr (local.get $lineEnd))
              (call $emitTok (enum.get $Token.tag.doctype) (local.get $lhs) (local.get $lineEnd))
              (br $rest)))
          (if
            (i32.or
              (i32.eq (local.get $c) (i32.const "/"))
              (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $p) (i32.const "#"))))
            (then
              (global.set $ptr (local.get $lineEnd))
              (call $emitTok (enum.get $Token.comment) (local.get $lhs) (local.get $lineEnd))
              (local.set $block
                (i32.or
                  (i32.or (i32.const 0x80) (enum.get $Token.comment))
                  (i32.shl (local.get $indent) (i32.const 8))))
              (br $rest)))
          (if (i32.eq (local.get $c) (i32.const "-"))
            (then
              (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
              (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
              (local.set $cont (call $hamlRubyLine (local.get $lineEnd)))
              (br $rest)))
          (if (i32.and (i32.eq (local.get $c) (i32.const ":")) (call $lexIsIdentStart (local.get $p)))
            (then
              (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
              (call $lexScanIdent)
              (local.set $kind
                (i32.or
                  (i32.const 0x80)
                  (call $indentFilterKind (i32.add (local.get $lhs) (i32.const 1)) (global.get $ptr))))
              (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (global.get $ptr))
              (call $emitTok (enum.get $Token.none) (global.get $ptr) (local.get $lineEnd))
              (global.set $ptr (local.get $lineEnd))
              (br $rest)))
          (if (i32.eq (local.get $c) (i32.const 92))
            (then
              (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
              (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
              (call $hamlText (local.get $lineEnd))
              (br $rest)))
          (if
            (i32.or
              (i32.eq (local.get $c) (i32.const "%"))
              (i32.and
                (i32.or (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c) (i32.const "#")))
                (i32.or (call $lexIsIdentContinue (local.get $p)) (i32.eq (local.get $p) (i32.const "-")))))
            (then
              (local.set $tag (call $hamlTag (local.get $lineEnd)))
              (local.set $cont (i32.eq (local.get $tag) (i32.const 0x40000000)))
              (local.set $tag (select (i32.const 0) (local.get $tag) (local.get $cont)))
              (br $rest)))
          (local.set $cont (i32.shr_u (call $hamlContent (local.get $lineEnd)) (i32.const 30))))
        (call $emitTok (enum.get $Token.none) (global.get $ptr) (local.get $lineEnd))
        (global.set $ptr (call $indentAfterBreak (local.get $lineEnd)))
        (call $emitGap (local.get $lineEnd) (global.get $ptr))
        (if (local.get $kind)
          (then
            (local.set $kind (i32.and (local.get $kind) (i32.const 127)))
            (if (local.get $kind)
              (then (drop (call $indentBody (local.get $kind) (local.get $indent) (i32.const 0))))
              (else (local.set $block (i32.or (i32.const 0x80) (i32.shl (local.get $indent) (i32.const 8))))))))
        (br $line))))
)
