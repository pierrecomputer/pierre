(module
  (import "./html.wat")
  (import "./css.wat")

  ;; Zero is an ordinary template, 1 starts HTML, and 260 starts CSS with
  ;; its statement decision pending. Each interpolation saves the body state.
  (global $jsTemplateMarker (mut i32) (i32.const 0))
  (global $jsTemplateState (mut i32) (i32.const 0))

  ;; Run the CSS lexer over one template part without touching its host's
  ;; stream checkpoint. Its packed result fits in the interpolation stack.
  (func $emitCssTemplateBody (param $from i32) (param $to i32)
    (local $savePtr i32)
    (local $saveEnd i32)
    (local $saveStreaming i32)
    (local $saveDialect i32)
    (local.set $savePtr (global.get $ptr))
    (local.set $saveEnd (global.get $end))
    (local.set $saveStreaming (global.get $streaming))
    (local.set $saveDialect (global.get $cssDialect))
    (global.set $ptr (local.get $from))
    (global.set $end (local.get $to))
    (global.set $streaming (i32.const 0))
    (global.set $cssDialect (i32.const 0))
    (global.set $jsTemplateState (call $hlCssImpl (global.get $jsTemplateState)))
    (global.set $cssDialect (local.get $saveDialect))
    (global.set $streaming (local.get $saveStreaming))
    (global.set $ptr (local.get $savePtr))
    (global.set $end (local.get $saveEnd)))

  ;; HTML template parts share name/entity scanners with HTML. Keep their
  ;; state separate: interpolations and script tags must not reset the outer
  ;; JavaScript lexer. Modes: 1 text, 2 tag name, 3 attributes, 4 value,
  ;; 5 unquoted value, 6 comment, 7 declaration, 8 PI, 34/39 quoted value.
  (func $emitHtmlTemplateBody (param $from i32) (param $to i32)
    (local $savePtr i32)
    (local $saveEnd i32)
    (local $p i32)
    (local $c i32)
    (local $mode i32)
    (local $hl i32)
    (local.set $savePtr (global.get $ptr))
    (local.set $saveEnd (global.get $end))
    (global.set $ptr (local.get $from))
    (global.set $end (local.get $to))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $p (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $p)))
        (local.set $mode (global.get $jsTemplateState))
        (if (i32.or (i32.eq (local.get $mode) (i32.const 34))
                    (i32.eq (local.get $mode) (i32.const 39)))
          (then
            (global.set $ptr (call $lexFindByte (global.get $ptr) (local.get $mode)))
            (if (i32.lt_u (global.get $ptr) (global.get $end))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (global.set $jsTemplateState (i32.const 3))))
            (call $emitEscaped (enum.get $Token.string) (local.get $p) (global.get $ptr))
            (br $next)))
        (if (i32.ge_u (local.get $mode) (i32.const 6))
          (then
            (block $close
              (loop $find
                (global.set $ptr (call $lexFindByte (global.get $ptr) (i32.const ">")))
                (br_if $close (i32.ge_u (global.get $ptr) (global.get $end)))
                (if (i32.or
                      (i32.eq (local.get $mode) (i32.const 7))
                      (i32.or
                        (i32.and
                          (i32.eq (local.get $mode) (i32.const 6))
                          (i32.and
                            (i32.ge_u (i32.sub (global.get $ptr) (local.get $from)) (i32.const 2))
                            (i32.eq (i32.load16_u (i32.sub (global.get $ptr) (i32.const 2))) (i32.const "--"))))
                        (i32.and
                          (i32.eq (local.get $mode) (i32.const 8))
                          (i32.and
                            (i32.gt_u (global.get $ptr) (local.get $from))
                            (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const "?"))))))
                  (then (global.set $jsTemplateState (i32.const 1))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br_if $close (i32.eq (global.get $jsTemplateState) (i32.const 1)))
                (br $find)))
            (call $emitTok
              (select (enum.get $Token.tag.doctype) (enum.get $Token.comment)
                (i32.eq (local.get $mode) (i32.const 7)))
              (local.get $p) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $mode) (i32.const 1))
          (then
            (if (i32.eq (local.get $c) (i32.const "&"))
              (then (if (call $htmlEntity) (then (br $next)))))
            (if (i32.eq (local.get $c) (i32.const "<"))
              (then
                (local.set $c (call $tsxByte (i32.add (local.get $p) (i32.const 1))))
                (if (i32.or (i32.eq (local.get $c) (i32.const "!"))
                            (i32.eq (local.get $c) (i32.const "?")))
                  (then
                    (global.set $jsTemplateState
                      (select (i32.const 8) (i32.const 7) (i32.eq (local.get $c) (i32.const "?"))))
                    (if (i32.and
                          (i32.le_u (i32.add (local.get $p) (i32.const 4)) (global.get $end))
                          (i32.eq (i32.load (local.get $p)) (i32.const "<!--")))
                      (then (global.set $jsTemplateState (i32.const 6))))
                    (br $next)))
                (if (i32.or
                      (i32.eq (local.get $c) (i32.const "/"))
                      (call $xmlNameStart (local.get $c)))
                  (then
                    (global.set $ptr (i32.add (local.get $p)
                      (select (i32.const 2) (i32.const 1) (i32.eq (local.get $c) (i32.const "/")))))
                    (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $p) (global.get $ptr))
                    (global.set $jsTemplateState (i32.const 2))
                    (br $next)))))
            (global.set $ptr (call $lexFindEither
              (i32.add (local.get $p) (i32.const 1)) (i32.const "<") (i32.const "&")))
            (call $emitEscaped (enum.get $Token.none) (local.get $p) (global.get $ptr))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 32))
                    (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4)))
          (then
            (call $scanWhitespace)
            (call $emitGap (local.get $p) (global.get $ptr))
            (if (i32.eq (local.get $mode) (i32.const 5))
              (then (global.set $jsTemplateState (i32.const 3))))
            (br $next)))
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (local.set $hl (enum.get $Token.punctuation.bracket.html))
        (if (i32.eq (local.get $c) (i32.const ">"))
          (then (global.set $jsTemplateState (i32.const 1)))
          (else
            (if (i32.eq (local.get $c) (i32.const "<"))
              (then
                (global.set $ptr (local.get $p))
                (global.set $jsTemplateState (i32.const 1))
                (br $next)))
            (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                        (i32.eq (local.get $c) (i32.const 39)))
              (then
                (global.set $jsTemplateState (local.get $c))
                (call $emitTok (enum.get $Token.string) (local.get $p) (global.get $ptr))
                (br $next)))
            (if (i32.or (i32.eq (local.get $mode) (i32.const 4))
                        (i32.eq (local.get $mode) (i32.const 5)))
              (then
                (global.set $ptr (call $htmlValueEnd (local.get $p)))
                (global.set $jsTemplateState (i32.const 5))
                (call $emitEscaped (enum.get $Token.string) (local.get $p) (global.get $ptr))
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const "="))
              (then
                (global.set $jsTemplateState (i32.const 4))
                (local.set $hl (enum.get $Token.punctuation.delimiter.html)))
              (else
                (if (i32.ne (local.get $c) (i32.const "/"))
                  (then
                    (global.set $ptr (call $htmlNameEnd (local.get $p)))
                    (local.set $hl (select (enum.get $Token.tag) (enum.get $Token.attribute)
                      (i32.eq (local.get $mode) (i32.const 2))))
                    (global.set $jsTemplateState (i32.const 3))))))))
        (call $emitTok (local.get $hl) (local.get $p) (global.get $ptr))
        (br $next)))
    (global.set $ptr (local.get $savePtr))
    (global.set $end (local.get $saveEnd)))
)
