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

  ;; Stream a directive expression [$from,$to) as TSX: $reset starts a fresh
  ;; expression, 0 continues one cut by the previous chunk end. Whole-buffer
  ;; runs use $vueTsxRange; the stream entry keeps the ECMAScript state
  ;; across chunks so the pieces classify like the whole.
  (func $vueTsxStream (param $from i32) (param $to i32) (param $reset i32)
    (local $save i32)
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (global.set $ptr (local.get $from))
    (call $hlTsxStream (local.get $reset))
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $to)))

  ;; Attributes of a Vue tag from $ptr until `>` / `/>`. Directive values
  ;; (`v-`, `:`, `@`, `#` attributes) are JavaScript expressions; other
  ;; values remain strings. The loop is a small state machine so a tag cut by
  ;; a chunk end resumes mid-attribute: $state 0 expects a name, 1 sits
  ;; after a name (an `=` may still follow), 2 sits after `=`, 3 sits inside
  ;; a quoted value whose open quote is $quote; $directive marks the pending
  ;; value as an expression. Returns 1 for `>`, 2 for `/>`, 0 for a stray
  ;; `<` (the next tag starts there) or input end. At a real chunk end the
  ;; open tag becomes stream region 11 with $streamA = $kind (1 script,
  ;; 2 style), $streamB = state | directive << 4, $streamC = quote, and a
  ;; directive value continues as a TSX stream.
  (func $vueAttrs
    (param $state i32) (param $directive i32) (param $quote i32) (param $kind i32)
    (result i32)
    (local $c i32)
    (local $lhs i32)
    (local $p i32)
    (local $tsxOpen i32)
    ;; a directive value already streaming continues the TSX stream
    (local.set $tsxOpen (i32.and
      (i32.eq (local.get $state) (i32.const 3)) (local.get $directive)))
    (block $done (result i32)
      (loop $next
        (if (i32.ge_u (global.get $ptr) (global.get $end))
          (then
            (if (i32.and
                  (global.get $streaming)
                  (i32.eq (global.get $ptr) (global.get $eof)))
              (then
                (call $streamSetRegion (i32.const 11))
                (global.set $streamA (local.get $kind))
                (global.set $streamB (i32.or
                  (local.get $state)
                  (i32.shl (local.get $directive) (i32.const 4))))
                (global.set $streamC (local.get $quote))))
            (br $done (i32.const 0))))
        (if (i32.eq (local.get $state) (i32.const 3))
          (then
            ;; the value body up to its closing quote
            (local.set $lhs (global.get $ptr))
            (local.set $p (call $lexFindByte (global.get $ptr) (local.get $quote)))
            (if (local.get $directive)
              (then
                (if (i32.lt_u (local.get $p) (global.get $end))
                  (then
                    (if (local.get $tsxOpen)
                      (then (call $vueTsxStream (local.get $lhs) (local.get $p) (i32.const 0)))
                      (else (call $vueTsxRange (local.get $lhs) (local.get $p))))
                    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                    (call $emitTok (enum.get $Token.string) (local.get $p) (global.get $ptr))
                    (local.set $state (i32.const 0))
                    (local.set $tsxOpen (i32.const 0)))
                  (else
                    ;; unterminated: at a real chunk end the expression
                    ;; continues in the next chunk, so stream it
                    (if (i32.and
                          (global.get $streaming)
                          (i32.eq (global.get $end) (global.get $eof)))
                      (then
                        (call $vueTsxStream (local.get $lhs) (global.get $end)
                          (i32.eqz (local.get $tsxOpen)))
                        (local.set $tsxOpen (i32.const 1)))
                      (else (call $vueTsxRange (local.get $lhs) (global.get $end))))
                    (global.set $ptr (global.get $end)))))
              (else
                (if (i32.lt_u (local.get $p) (global.get $end))
                  (then
                    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                    (local.set $state (i32.const 0)))
                  (else (global.set $ptr (global.get $end))))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))))
            (br $next)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        ;; whitespace: every state survives it
        (if (call $lexIsSpace (local.get $c))
          (then
            (call $scanWhitespace)
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ">"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
            (br $done (i32.const 1))))
        (if (i32.eq (local.get $c) (i32.const "<"))
          (then (br $done (i32.const 0))))
        ;; after a name only `=` continues the attribute
        (if (i32.eq (local.get $state) (i32.const 1))
          (then
            (local.set $state (i32.const 0))
            (if (i32.eq (local.get $c) (i32.const "="))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.delimiter.html) (local.get $lhs) (global.get $ptr))
                (local.set $state (i32.const 2))
                (br $next)))))
        ;; the value after `=`: quoted, or a lenient unquoted run
        (if (i32.eq (local.get $state) (i32.const 2))
          (then
            (local.set $state (i32.const 0))
            (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                        (i32.eq (local.get $c) (i32.const 39)))
              (then
                (local.set $quote (local.get $c))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (local.set $state (i32.const 3))
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const "/"))
              (then
                ;; `/>` closes the tag; a lone slash is a value byte
                (if (i32.and
                      (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
                      (i32.eq (i32.load8_u offset=1 (global.get $ptr)) (i32.const ">")))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                    (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
                    (br $done (i32.const 2))))))
            (global.set $ptr (call $htmlValueEnd (global.get $ptr)))
            (if (local.get $directive)
              (then (call $vueTsxRange (local.get $lhs) (global.get $ptr)))
              (else (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))))
            (br $next)))
        ;; an attribute name; `/>` closes, other stray punctuation is plain
        (if (i32.eq (local.get $c) (i32.const "/"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.and (i32.lt_u (global.get $ptr) (global.get $end))
                         (i32.eq (i32.load8_u (global.get $ptr)) (i32.const ">")))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
                (br $done (i32.const 2))))
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.or
              (i32.eq (local.get $c) (i32.const "="))
              (i32.or (i32.eq (local.get $c) (i32.const 34))
                      (i32.eq (local.get $c) (i32.const 39))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (local.set $directive (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const ":"))
                  (i32.eq (local.get $c) (i32.const "@")))
          (i32.or
            (i32.eq (local.get $c) (i32.const "#"))
            (i32.and
              (i32.eq (local.get $c) (i32.const "v"))
              (i32.and
                (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
                (i32.eq (i32.load8_u offset=1 (global.get $ptr)) (i32.const "-")))))))
        ;; every byte $htmlNameEnd refuses was taken above, so the name is
        ;; never empty
        (global.set $ptr (call $htmlNameEnd (global.get $ptr)))
        (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
        (local.set $state (i32.const 1))
        (br $next))
      (unreachable)))

  ;; `<name ...>` or `</name ...>` at $ptr. A raw-text body follows a
  ;; completed script/style start tag, leaving $ptr on its close tag's `<`.
  (func $vueTag
    (local $close i32)
    (local $kind i32)
    (local $lhs i32)
    (local $q i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (if (i32.and
          (i32.lt_u (global.get $ptr) (global.get $end))
          (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "/")))
      (then
        (local.set $close (i32.const 1))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
    (call $emitTok (enum.get $Token.punctuation.bracket.html)
      (local.get $lhs) (global.get $ptr))
    (local.set $q (call $htmlNameEnd (global.get $ptr)))
    (if (i32.eqz (local.get $close))
      (then (local.set $kind (call $rawTextKind (global.get $ptr) (local.get $q)))))
    (call $emitTok (enum.get $Token.tag) (global.get $ptr) (local.get $q))
    (global.set $ptr (local.get $q))
    (if (i32.and
          (i32.ne
            (call $vueAttrs (i32.const 0) (i32.const 0) (i32.const 0) (local.get $kind))
            (i32.const 0))
          (i32.ne (local.get $kind) (i32.const 0)))
      (then (call $htmlRawText (local.get $kind)))))

  (func $hlVue
    (local $c i32)
    (local $complete i32)
    (local $from i32)
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
            (if (i32.and
                  (i32.le_u (i32.add (local.get $p) (i32.const 4)) (global.get $end))
                  (i32.eq (i32.load (local.get $p)) (i32.const "<!--")))
              (then
                (call $vueHtmlRange (local.get $from) (local.get $p))
                (global.set $ptr (local.get $p))
                (call $htmlComment (local.get $p))
                (local.set $from (global.get $ptr))
                (local.set $p (global.get $ptr))
                (br $scan)))
            ;; Tags are Vue's own: directive values are expressions, and a
            ;; script/style body is scanned once here. Declarations remain
            ;; the HTML lexer's job.
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
                (call $vueHtmlRange (local.get $from) (local.get $p))
                (global.set $ptr (local.get $p))
                (call $vueTag)
                (local.set $from (global.get $ptr))
                (local.set $p (global.get $ptr))
                (br $scan)))))
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "{"))
              (i32.and
                (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
                (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "{"))))
          (then
            (local.set $to (call $tsxExpressionEnd (local.get $p) (local.get $p)))
            (local.set $complete (i32.and
              (i32.ge_u
                (i32.sub (local.get $to) (local.get $p))
                (i32.const 4))
              (i32.eq
                (i32.and
                  (i32.load (i32.sub (local.get $to) (i32.const 2)))
                  (i32.const 0xffff))
                (i32.const "}}"))))
            (call $vueHtmlRange (local.get $from) (local.get $p))
            (call $emitTok (enum.get $Token.punctuation.special)
              (local.get $p) (i32.add (local.get $p) (i32.const 2)))
            (if (i32.and (global.get $streaming) (i32.eqz (local.get $complete)))
              (then
                (global.set $ptr (global.get $end))
                (call $streamSetRegion (i32.const 6))
                (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
                (drop (call $hlTsxExpressionStream
                  (i32.const 1) (i32.const 2)))
                (global.set $ptr (global.get $end))
                (global.set $streamRegionStarted (i32.const 1)))
              (else
                (call $vueTsxRange
                  (i32.add (local.get $p) (i32.const 2))
                  (select
                    (i32.sub (local.get $to) (i32.const 2))
                    (local.get $to)
                    (local.get $complete)))))
            (if (local.get $complete)
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

  ;; Resume stream region 11: a start tag whose attributes continue past
  ;; the previous chunk end. Returns 1 when the region consumed the whole
  ;; chunk, 0 when the language lexer should continue from $ptr.
  (func $vueStreamResumeTag (result i32)
    (local $kind i32)
    (local.set $kind (global.get $streamA))
    (global.set $streamDepth (i32.const 1))
    (call $htmlTagResumeEnd
      (call $vueAttrs
        (i32.and (global.get $streamB) (i32.const 15))
        (i32.shr_u (global.get $streamB) (i32.const 4))
        (global.get $streamC)
        (local.get $kind))
      (local.get $kind)))
)
