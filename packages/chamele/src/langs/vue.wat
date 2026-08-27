(module
  (import "../common.wat")
  (import "./html.wat")

  (func $vueHtmlRange (param $from i32) (param $to i32)
    (local $save i32)
    (if (i32.ge_u (local.get $from) (local.get $to)) (then (return)))
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (global.set $ptr (local.get $from))
    (call $hlHtml)
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $to)))

  (func $vueTsxRange (param $from i32) (param $to i32)
    (local $save i32)
    (if (i32.ge_u (local.get $from) (local.get $to)) (then (return)))
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (global.set $ptr (local.get $from))
    (call $hlTsx)
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $to)))

  (func $vueTagEnd (param $lhs i32) (result i32)
    (local $c i32)
    (local $p i32)
    (local $quote i32)
    (local $value i32) ;; 0 tag/name, 1 after `=`, 2 unquoted value
    (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (local.get $quote)
          (then
            (if (i32.eq (local.get $c) (local.get $quote))
              (then (local.set $quote (i32.const 0)))))
          (else
            (if (i32.eq (local.get $c) (i32.const ">"))
              (then (return (i32.add (local.get $p) (i32.const 1)))))
            (if (i32.and
                  (i32.eq (local.get $value) (i32.const 1))
                  (i32.eqz (call $lexIsSpace (local.get $c))))
              (then
                (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                            (i32.eq (local.get $c) (i32.const 39)))
                  (then
                    (local.set $quote (local.get $c))
                    (local.set $value (i32.const 0)))
                  (else (local.set $value (i32.const 2))))))
            (if (i32.and
                  (i32.eq (local.get $value) (i32.const 2))
                  (call $lexIsSpace (local.get $c)))
              (then (local.set $value (i32.const 0))))
            (if (i32.and
                  (i32.eqz (local.get $value))
                  (i32.eq (local.get $c) (i32.const "=")))
              (then (local.set $value (i32.const 1))))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (i32.add (local.get $lhs) (i32.const 1)))

  (func $vueRawKind (param $p i32) (result i32)
    (local $kind i32)
    (local $q i32)
    (local.set $q (i32.add (local.get $p) (i32.const 1)))
    (if (i32.le_u (i32.add (local.get $q) (i32.const 6)) (global.get $end))
      (then (local.set $kind (call $rawTextKind (local.get $q) (i32.add (local.get $q) (i32.const 6))))))
    (if (i32.eqz (local.get $kind))
      (then
        (if (i32.le_u (i32.add (local.get $q) (i32.const 5)) (global.get $end))
          (then (local.set $kind (call $rawTextKind (local.get $q) (i32.add (local.get $q) (i32.const 5))))))))
    (if (local.get $kind)
      (then
        (local.set $q (i32.add (local.get $q)
          (select (i32.const 6) (i32.const 5) (i32.eq (local.get $kind) (i32.const 1)))))
        (if (i32.and
              (i32.lt_u (local.get $q) (global.get $end))
              (i32.eqz (i32.or
                (call $lexIsSpace (i32.load8_u (local.get $q)))
                (i32.or
                  (i32.eq (i32.load8_u (local.get $q)) (i32.const ">"))
                  (i32.eq (i32.load8_u (local.get $q)) (i32.const "/"))))))
          (then (return (i32.const 0))))))
    (local.get $kind))

  (func $vueRawEnd (param $p i32) (param $kind i32) (result i32)
    (local $c i32)
    (local $quote i32)
    (block $openDone
      (loop $open
        (br_if $openDone (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (local.get $quote)
          (then
            (if (i32.eq (local.get $c) (local.get $quote))
              (then (local.set $quote (i32.const 0)))))
          (else
            (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                        (i32.eq (local.get $c) (i32.const 39)))
              (then (local.set $quote (local.get $c)))
              (else
                (if (i32.eq (local.get $c) (i32.const ">"))
                  (then
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br $openDone)))))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $open)))
    (block $done
      (loop $body
        (local.set $p (call $lexFindEither
          (local.get $p) (i32.const "<") (i32.const "<")))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (if (i32.and
              (i32.eq (i32.load8_u (local.get $p)) (i32.const "<"))
              (call $isRawTextClose (local.get $p) (local.get $kind)))
          (then
            (block $tagDone
              (loop $tag
                (br_if $tagDone (i32.ge_u (local.get $p) (global.get $end)))
                (local.set $c (i32.load8_u (local.get $p)))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br_if $tagDone (i32.eq (local.get $c) (i32.const ">")))
                (br $tag)))
            (return (local.get $p))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $body)))
    (global.get $end))

  ;; Parse one ordinary Vue tag. Directive values are JavaScript expressions;
  ;; normal HTML attribute values remain strings.
  (func $vueTag (param $from i32) (param $to i32)
    (local $attr i32)
    (local $c i32)
    (local $directive i32)
    (local $lhs i32)
    (local $p i32)
    (local $quote i32)
    (global.set $ptr (i32.add (local.get $from) (i32.const 1)))
    (if (i32.and
          (i32.lt_u (global.get $ptr) (local.get $to))
          (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "/")))
      (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
    (call $emitTok (enum.get $Token.punctuation.bracket.html)
      (local.get $from) (global.get $ptr))
    (local.set $lhs (global.get $ptr))
    (block $nameDone
      (loop $name
        (br_if $nameDone (i32.ge_u (global.get $ptr) (local.get $to)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (br_if $nameDone (i32.or
          (call $lexIsSpace (local.get $c))
          (i32.or (i32.eq (local.get $c) (i32.const ">"))
                  (i32.eq (local.get $c) (i32.const "/")))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $name)))
    (call $emitTok (enum.get $Token.tag) (local.get $lhs) (global.get $ptr))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (local.get $to)))
        (local.set $lhs (global.get $ptr))
        (block $spaceDone
          (loop $space
            (br_if $spaceDone (i32.ge_u (global.get $ptr) (local.get $to)))
            (br_if $spaceDone (i32.eqz (call $lexIsSpace (i32.load8_u (global.get $ptr)))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $space)))
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (local.get $to)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const ">"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
            (br $done)))
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "/"))
              (i32.and
                (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (local.get $to))
                (i32.eq (i32.load8_u offset=1 (global.get $ptr)) (i32.const ">"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
            (br $done)))
        (local.set $attr (global.get $ptr))
        (local.set $directive (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const ":"))
                  (i32.eq (local.get $c) (i32.const "@")))
          (i32.or
            (i32.eq (local.get $c) (i32.const "#"))
            (i32.and
              (i32.eq (local.get $c) (i32.const "v"))
              (i32.and
                (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (local.get $to))
                (i32.eq (i32.load8_u offset=1 (global.get $ptr)) (i32.const "-")))))))
        (block $attrDone
          (loop $attrName
            (br_if $attrDone (i32.ge_u (global.get $ptr) (local.get $to)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $attrDone (i32.or
              (call $lexIsSpace (local.get $c))
              (i32.or
                (i32.eq (local.get $c) (i32.const "="))
                (i32.or (i32.eq (local.get $c) (i32.const ">"))
                        (i32.eq (local.get $c) (i32.const "/"))))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $attrName)))
        (if (i32.eq (global.get $ptr) (local.get $attr))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (call $emitTok (enum.get $Token.attribute) (local.get $attr) (global.get $ptr))
        (local.set $lhs (global.get $ptr))
        (block $eqSpaceDone
          (loop $eqSpace
            (br_if $eqSpaceDone (i32.ge_u (global.get $ptr) (local.get $to)))
            (br_if $eqSpaceDone (i32.eqz (call $lexIsSpace (i32.load8_u (global.get $ptr)))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $eqSpace)))
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (if (i32.or
              (i32.ge_u (global.get $ptr) (local.get $to))
              (i32.ne (i32.load8_u (global.get $ptr)) (i32.const "=")))
          (then (br $next)))
        (local.set $lhs (global.get $ptr))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.delimiter.html) (local.get $lhs) (global.get $ptr))
        (local.set $lhs (global.get $ptr))
        (block $valueSpaceDone
          (loop $valueSpace
            (br_if $valueSpaceDone (i32.ge_u (global.get $ptr) (local.get $to)))
            (br_if $valueSpaceDone (i32.eqz (call $lexIsSpace (i32.load8_u (global.get $ptr)))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $valueSpace)))
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (local.get $to)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                    (i32.eq (local.get $c) (i32.const 39)))
          (then
            (local.set $quote (local.get $c))
            (local.set $p (i32.add (global.get $ptr) (i32.const 1)))
            (global.set $ptr (local.get $p))
            (block $quoteDone
              (loop $quoteValue
                (br_if $quoteDone (i32.ge_u (global.get $ptr) (local.get $to)))
                (br_if $quoteDone (i32.eq (i32.load8_u (global.get $ptr)) (local.get $quote)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $quoteValue)))
            (if (local.get $directive)
              (then
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (local.get $p))
                (call $vueTsxRange (local.get $p) (global.get $ptr))
                (if (i32.lt_u (global.get $ptr) (local.get $to))
                  (then
                    (local.set $lhs (global.get $ptr))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr)))))
              (else
                (if (i32.lt_u (global.get $ptr) (local.get $to))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))))
            (br $next)))
        ;; Lenient unquoted value.
        (block $unquotedDone
          (loop $unquoted
            (br_if $unquotedDone (i32.ge_u (global.get $ptr) (local.get $to)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $unquotedDone (i32.or
              (call $lexIsSpace (local.get $c))
              (i32.eq (local.get $c) (i32.const ">"))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $unquoted)))
        (if (local.get $directive)
          (then (call $vueTsxRange (local.get $lhs) (global.get $ptr)))
          (else (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))))
        (br $next)))
    (global.set $ptr (local.get $to)))

  (func $hlVue
    (local $c i32)
    (local $from i32)
    (local $kind i32)
    (local $p i32)
    (local $to i32)
    (call $lexEmitLeadingContinuation)
    (local.set $from (global.get $ptr))
    (local.set $p (global.get $ptr))
    (block $done
      (loop $scan
        (local.set $p (call $lexFindEither
          (local.get $p) (i32.const "{") (i32.const "<")))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.eq (local.get $c) (i32.const "<"))
          (then
            (local.set $kind (call $vueRawKind (local.get $p)))
            (if (local.get $kind)
              (then
                (local.set $to (call $vueRawEnd (local.get $p) (local.get $kind)))
                (call $vueHtmlRange (local.get $from) (local.get $p))
                (call $vueHtmlRange (local.get $p) (local.get $to))
                (local.set $from (local.get $to))
                (local.set $p (local.get $to))
                (br $scan)))
            (if (i32.and
                  (i32.le_u (i32.add (local.get $p) (i32.const 4)) (global.get $end))
                  (i32.eq (i32.load (local.get $p)) (i32.const "<!--")))
              (then
                (call $vueHtmlRange (local.get $from) (local.get $p))
                (global.set $ptr (local.get $p))
                (call $htmlComment (local.get $p))
                (local.set $to (global.get $ptr))
                (local.set $from (local.get $to))
                (local.set $p (local.get $to))
                (br $scan)))
            ;; Comments/declarations remain the HTML lexer's job.
            (if (i32.and
                  (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
                  (i32.or
                    (call $lexIsIdentStart (i32.load8_u offset=1 (local.get $p)))
                    (i32.and
                      (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "/"))
                      (i32.and
                        (i32.lt_u (i32.add (local.get $p) (i32.const 2)) (global.get $end))
                        (call $lexIsIdentStart (i32.load8_u offset=2 (local.get $p)))))))
              (then
                (local.set $to (call $vueTagEnd (local.get $p)))
                (if (i32.gt_u (local.get $to) (i32.add (local.get $p) (i32.const 1)))
                  (then
                    (call $vueHtmlRange (local.get $from) (local.get $p))
                    (call $vueTag (local.get $p) (local.get $to))
                    (local.set $from (local.get $to))
                    (local.set $p (local.get $to))
                    (br $scan)))))))
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "{"))
              (i32.and
                (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
                (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "{"))))
          (then
            (local.set $to (call $tsxExpressionEnd (local.get $p) (local.get $p)))
            (call $vueHtmlRange (local.get $from) (local.get $p))
            (call $emitTok (enum.get $Token.punctuation.special)
              (local.get $p) (i32.add (local.get $p) (i32.const 2)))
            (call $vueTsxRange
              (i32.add (local.get $p) (i32.const 2))
              (select (i32.sub (local.get $to) (i32.const 2)) (local.get $to)
                (i32.and
                  (i32.ge_u (i32.sub (local.get $to) (local.get $p)) (i32.const 4))
                  (i32.eq (i32.and (i32.load (i32.sub (local.get $to) (i32.const 2))) (i32.const 0xffff))
                          (i32.const "}}")))))
            (if (i32.and
                  (i32.ge_u (i32.sub (local.get $to) (local.get $p)) (i32.const 4))
                  (i32.eq (i32.and (i32.load (i32.sub (local.get $to) (i32.const 2))) (i32.const 0xffff))
                          (i32.const "}}")))
              (then
                (call $emitTok (enum.get $Token.punctuation.special)
                  (i32.sub (local.get $to) (i32.const 2)) (local.get $to))))
            (local.set $from (local.get $to))
            (local.set $p (local.get $to))
            (br $scan)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (call $vueHtmlRange (local.get $from) (global.get $end))
    (global.set $ptr (global.get $end)))
)
