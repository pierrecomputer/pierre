(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (import "@pierre/wat-tools/common.wat")
  (import "../embed.wat")
  (import "./embed-line.wat")
  (import "./html.wat")
  (import "./template.wat")

  ;; The value state $markoValueEnd leaves for the next line.
  (global $markoValueState (mut i32) (i32.const 0))

  ;; Where a JavaScript attribute value from $p ends within the line ending at
  ;; $to: at bracket depth 0, a blank, `,`, `>`, or `/>`, unless an operator
  ;; joins the next term or a `) {` method body follows. $state: the bracket
  ;; depth, and bit 16 inside a template literal; $markoValueState gets it
  ;; back, nonzero when the value goes on to the next line.
  (func $markoValueEnd (param $p i32) (param $to i32) (param $state i32) (result i32)
    (local $c i32)
    (local $n i32)
    (local $q i32)
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (local.get $p) (local.get $to)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.and (local.get $state) (i32.const 0x10000))
          (then
            (local.set $p (call $scanFindSpecial (local.get $p) (local.get $to) (i32.const "`") (i32.const 1) (i32.const 0)))
            (br_if $done (i32.ge_u (local.get $p) (local.get $to)))
            (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "`"))
              (then (local.set $state (i32.xor (local.get $state) (i32.const 0x10000))))
              (else (local.set $p (i32.add (local.get $p) (i32.const 1)))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $scan)))
        (block $byte
          (if (byteset.get "([{" (local.get $c))
            (then
              (local.set $state (i32.add (local.get $state) (i32.const 1)))
              (br $byte)))
          (if (byteset.get ")]}" (local.get $c))
            (then
              (br_if $done (i32.eqz (i32.and (local.get $state) (i32.const 0xffff))))
              (local.set $state (i32.sub (local.get $state) (i32.const 1)))
              (br $byte)))
          (if (i32.eq (local.get $c) (i32.const "`"))
            (then
              (local.set $state (i32.or (local.get $state) (i32.const 0x10000)))
              (br $byte)))
          (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
            (then
              (loop $quote
                (local.set $p
                  (call $scanFindSpecial (i32.add (local.get $p) (i32.const 1)) (local.get $to) (local.get $c) (i32.const 1) (i32.const 1)))
                (if (i32.eq (call $templateByte (local.get $p)) (i32.const 92))
                  (then
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br $quote))))
              (br_if $done (i32.ne (call $templateByte (local.get $p)) (local.get $c)))
              (br $byte)))
          (br_if $byte (i32.and (local.get $state) (i32.const 0xffff)))
          (local.set $n (call $templateByte (i32.add (local.get $p) (i32.const 1))))
          (br_if $done (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const "<"))))
          (br_if $done (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $n) (i32.const ">"))))
          (if (i32.eq (local.get $c) (i32.const ">"))
            (then (br_if $done (i32.ne (call $templateByte (i32.sub (local.get $p) (i32.const 1))) (i32.const "=")))))
          (br_if $byte (i32.eqz (call $lexIsSpace (local.get $c))))
          (br_if $done (byteset.get "\n\r" (local.get $c)))
          ;; a blank: the value goes on after an operator or before one
          (local.set $q (call $lexSkipSpaceAt (local.get $p)))
          (local.set $c (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))
          (local.set $n (call $templateByte (local.get $q)))
          (if
            (i32.eqz
              (i32.or
                (byteset.get "!%&*+-/<=>?^|~" (local.get $c))
                (i32.and (i32.eq (local.get $n) (i32.const "{")) (i32.eq (local.get $c) (i32.const ")")))))
            (then
              (br_if $done (i32.eqz (byteset.get "!%&*+-/:<=>?^|~" (local.get $n))))
              (br_if $done (i32.or (i32.eq (local.get $n) (i32.const "<")) (i32.eq (local.get $n) (i32.const ">"))))
              (local.set $c (call $templateByte (i32.add (local.get $q) (i32.const 1))))
              (br_if $done
                (i32.and
                  (i32.eq (local.get $n) (i32.const "/"))
                  (i32.or
                    (i32.or (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c) (i32.const "*")))
                    (i32.eq (local.get $c) (i32.const ">")))))
              (br_if $done
                (i32.and
                  (i32.eq (local.get $n) (i32.const "="))
                  (i32.and (i32.ne (local.get $c) (i32.const "=")) (i32.ne (local.get $c) (i32.const ">")))))))
          (local.set $p (local.get $q))
          (br $scan))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (global.set $markoValueState (select (local.get $state) (i32.const 0) (i32.ge_u (local.get $p) (local.get $to))))
    (select (local.get $p) (local.get $to) (i32.lt_u (local.get $p) (local.get $to))))

  ;; A quoted attribute value at $ptr, within the line ending at $to: a string
  ;; with escapes and `${}` placeholders lexed as JavaScript.
  (func $markoString (param $to i32)
    (local $c i32)
    (local $p i32)
    (local $q i32)
    (local $save i32)
    (local $seg i32)
    (local.set $q (i32.load8_u (global.get $ptr)))
    (local.set $seg (global.get $ptr))
    (local.set $p (i32.add (local.get $seg) (i32.const 1)))
    (block $done
      (loop $scan
        (local.set $save (global.get $end))
        (global.set $end (local.get $to))
        (local.set $p (call $tmplFind4 (local.get $p) (local.get $q) (i32.const "$") (i32.const 92) (i32.const 10)))
        (global.set $end (local.get $save))
        (br_if $done (i32.ge_u (local.get $p) (local.get $to)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $done (i32.eq (local.get $c) (i32.const 10)))
        (if (i32.eq (local.get $c) (local.get $q))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $done)))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "$"))
            (i32.ne (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const "{")))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $scan)))
        (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (local.set $c (call $templateByte (global.get $ptr)))
        (if (i32.eq (i32.load8_u (local.get $p)) (i32.const 92))
          (then
            (if (i32.eqz (byteset.get "\n\r" (local.get $c)))
              (then (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $p) (i32.const 2)) (local.get $to)))))
            (call $emitTok (enum.get $Token.string.escape) (local.get $p) (global.get $ptr)))
          (else
            (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $p) (global.get $ptr))
            ;; a placeholder left open ends the value with the line
            (br_if $done (call $embedJsLine (local.get $to) (i32.const 1) (i32.const 1)))
            (local.set $p (global.get $ptr))
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $p) (global.get $ptr))))
        (local.set $seg (global.get $ptr))
        (local.set $p (global.get $ptr))
        (br $scan)))
    (if (i32.lt_u (global.get $ptr) (local.get $p))
      (then
        (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
        (global.set $ptr (local.get $p)))))

  ;; A tag name [$lhs, $rhs): control-flow tags are keywords.
  (func $markoTagName (param $lhs i32) (param $rhs i32)
    (local $n i32)
    (local $w i64)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (local.set $w
      (i64.and
        (i64.load (local.get $lhs))
        (i64.sub (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $n) (i32.const 3)))) (i64.const 1))))
    (call $emitTok
      (select
        (enum.get $Token.keyword.control)
        (enum.get $Token.tag)
        (i32.and
          (i32.le_u (local.get $n) (i32.const 7))
          (i32.or
            (i32.or
              (i32.or (i64.eq (local.get $w) (i64.const "if")) (i64.eq (local.get $w) (i64.const "for")))
              (i32.or (i64.eq (local.get $w) (i64.const "else")) (i64.eq (local.get $w) (i64.const "else-if"))))
            (i32.or (i64.eq (local.get $w) (i64.const "while")) (i64.eq (local.get $w) (i64.const "await"))))))
      (local.get $lhs)
      (local.get $rhs)))

  ;; $mode: 0 text, 1 inside a tag, 2 an attribute value that goes on, 3 a
  ;; `${}` placeholder (+256 inside a tag name, +512 on its first line), 4 a
  ;; JavaScript statement, 5 a `style {}` block; bits 16+ the raw-text kind
  ;; of a `<script>` or `<style>` tag. $value: the $markoValueEnd state.
  ;; $css: the packed CSS state of a style block.
  (func $hlMarko
    (local $mode i32)
    (local $value i32)
    (local $css i32)
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $lineEnd i32)
    (local $p i32)
    (local $q i32)
    (local $resumed i32)
    (local $w i64)
    (call $lexEmitLeadingContinuation)
    (local.set $lineEnd (i32.const 0))
    (local.set $resumed (i32.const 0))
    (if (global.get $streamRegionKind)
      (then (local.set $resumed (call $streamResumeAnyRegion))))
    (block $done
      (br_if $done (local.get $resumed))
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        ;; the line end, found once per line
        (if (i32.ge_u (local.get $lhs) (local.get $lineEnd))
          (then (local.set $lineEnd (call $embedLineEnd (local.get $lhs)))))
        (local.set $c (i32.and (local.get $mode) (i32.const 255)))
        (block $value
          (if (i32.eq (local.get $c) (i32.const 2))
            (then
              (global.set $ptr (call $lexSkipSpaceAt (local.get $lhs)))
              (call $emitGap (local.get $lhs) (global.get $ptr))
              (br $value)))
          (if (i32.eq (local.get $c) (i32.const 3))
            (then
              (if
                (i32.eqz
                  (call $embedJsLine
                    (local.get $lineEnd)
                    (i32.ne (i32.and (local.get $mode) (i32.const 512)) (i32.const 0))
                    (i32.const 1)))
                (then
                  (local.set $p (global.get $ptr))
                  (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                  (call $emitTok (enum.get $Token.punctuation.special) (local.get $p) (global.get $ptr))
                  (local.set $mode (i32.shr_u (i32.and (local.get $mode) (i32.const 256)) (i32.const 8)))
                  (br $next)))
              (local.set $mode (i32.and (local.get $mode) (i32.const -513)))
              (br $next)))
          (if (i32.eq (local.get $c) (i32.const 4))
            (then
              (if (i32.eqz (call $embedJsLine (local.get $lineEnd) (i32.const 0) (i32.const 0)))
                (then (local.set $mode (i32.const 0))))
              (br $next)))
          (if (i32.eq (local.get $c) (i32.const 5))
            (then
              (local.set $css (call $embedCssLine (local.get $lineEnd) (local.get $css)))
              (if (i32.eqz (i32.and (local.get $css) (i32.const 0x0ffffe00)))
                (then (local.set $mode (i32.const 0))))
              (br $next)))
          (if (i32.eq (local.get $c) (i32.const 1))
            (then
              (call $scanWhitespace)
              (call $emitGap (local.get $lhs) (global.get $ptr))
              (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
              (local.set $lhs (global.get $ptr))
              (if (i32.ge_u (local.get $lhs) (local.get $lineEnd))
                (then (local.set $lineEnd (call $embedLineEnd (local.get $lhs)))))
              (local.set $c (i32.load8_u (local.get $lhs)))
              (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
              (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
              (if (i32.eq (local.get $c) (i32.const ">"))
                (then
                  (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
                  (local.set $c (i32.shr_u (local.get $mode) (i32.const 16)))
                  (local.set $mode (i32.const 0))
                  (if (local.get $c)
                    (then (call $htmlRawText (local.get $c))))
                  (br $next)))
              (if (i32.eq (local.get $c) (i32.const "/"))
                (then
                  (if (i32.eq (local.get $c2) (i32.const ">"))
                    (then
                      (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                      (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
                      (local.set $mode (i32.const 0))
                      (br $next)))
                  (global.set $ptr (local.get $lhs))
                  (if (i32.eq (local.get $c2) (i32.const "/"))
                    (then
                      (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
                      (br $next)))
                  (if (i32.eq (local.get $c2) (i32.const "*"))
                    (then
                      (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
                      (br $next)))
                  ;; a tag variable: `/name` or a destructuring pattern
                  (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                  (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                  (br_if $value (i32.or (i32.eq (local.get $c2) (i32.const "{")) (i32.eq (local.get $c2) (i32.const "["))))
                  (br_if $next (i32.eqz (call $lexIsIdentStart (local.get $c2))))
                  (local.set $p (global.get $ptr))
                  (call $lexScanIdent)
                  (call $emitTok (enum.get $Token.variable) (local.get $p) (global.get $ptr))
                  (br $next)))
              ;; shorthand `.class` and `#id`
              (if
                (i32.and
                  (i32.or (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c) (i32.const "#")))
                  (call $lexIsIdentStart (local.get $c2)))
                (then
                  (call $scanIdentRun (i32.const "-"))
                  (call $emitTok
                    (select (enum.get $Token.selector.class) (enum.get $Token.selector.id) (i32.eq (local.get $c) (i32.const ".")))
                    (local.get $lhs)
                    (global.get $ptr))
                  (br $next)))
              ;; tag parameters `|item, i|`
              (if (i32.eq (local.get $c) (i32.const "|"))
                (then
                  (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                  (local.set $q (call $scanFindSpecial (global.get $ptr) (local.get $lineEnd) (i32.const "|") (i32.const 0) (i32.const 1)))
                  (block $params
                    (loop $param
                      (local.set $p (global.get $ptr))
                      (br_if $params (i32.ge_u (local.get $p) (local.get $q)))
                      (local.set $c (i32.load8_u (local.get $p)))
                      (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                      (if (call $lexIsIdentStart (local.get $c))
                        (then
                          (call $lexScanIdent)
                          (if (i32.gt_u (global.get $ptr) (local.get $q))
                            (then (global.set $ptr (local.get $q))))
                          (call $emitTok (enum.get $Token.variable.parameter) (local.get $p) (global.get $ptr))
                          (br $param)))
                      (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (local.get $q)))
                      (call $emitTok
                        (select (enum.get $Token.punctuation.delimiter) (enum.get $Token.none) (i32.eq (local.get $c) (i32.const ",")))
                        (local.get $p)
                        (global.get $ptr))
                      (br $param)))
                  (if (i32.eq (call $templateByte (local.get $q)) (i32.const "|"))
                    (then
                      (global.set $ptr (i32.add (local.get $q) (i32.const 1)))
                      (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $q) (global.get $ptr))))
                  (br $next)))
              ;; a tag variable's value `<let/x=1>`
              (if (i32.eq (local.get $c) (i32.const "="))
                (then
                  (call $emitTok (enum.get $Token.punctuation.delimiter.html) (local.get $lhs) (global.get $ptr))
                  (br_if $next (call $lexIsSpace (local.get $c2)))
                  (br $value)))
              (if (i32.eq (local.get $c) (i32.const ","))
                (then
                  (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
                  (br $next)))
              (if (i32.eq (local.get $c) (i32.const "<"))
                (then
                  (global.set $ptr (local.get $lhs))
                  (local.set $mode (i32.const 0))
                  (br $next)))
              ;; arguments `(args)` and a spread `...value`
              (if (i32.eq (local.get $c) (i32.const "("))
                (then
                  (global.set $ptr (local.get $lhs))
                  (br $value)))
              (if
                (i32.and
                  (i32.eq (local.get $c) (i32.const "."))
                  (i32.and
                    (i32.eq (local.get $c2) (i32.const "."))
                    (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "."))))
                (then
                  (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))
                  (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                  (br $value)))
              (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
                (then
                  (global.set $ptr (local.get $lhs))
                  (call $markoString (local.get $lineEnd))
                  (br $next)))
              (if
                (i32.or
                  (call $lexIsIdentStart (local.get $c))
                  (i32.or (i32.eq (local.get $c) (i32.const "@")) (i32.eq (local.get $c) (i32.const ":"))))
                (then
                  (block $name
                    (loop $part
                      (call $scanIdentRun (i32.const "-"))
                      (local.set $c (call $templateByte (global.get $ptr)))
                      (br_if $name (i32.and (i32.ne (local.get $c) (i32.const ":")) (i32.ne (local.get $c) (i32.const "@"))))
                      (br_if $name (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "=")))
                      (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                      (br $part)))
                  (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
                  (local.set $p (global.get $ptr))
                  (local.set $c (call $templateByte (local.get $p)))
                  (br_if $value (i32.eq (local.get $c) (i32.const "(")))
                  (local.set $p (i32.add (local.get $p) (i32.eq (local.get $c) (i32.const ":"))))
                  (br_if $next (i32.ne (call $templateByte (local.get $p)) (i32.const "=")))
                  (local.set $q (global.get $ptr))
                  (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                  (call $emitTok (enum.get $Token.punctuation.delimiter.html) (local.get $q) (global.get $ptr))
                  (local.set $c (call $templateByte (global.get $ptr)))
                  (br_if $next (i32.or (i32.eqz (local.get $c)) (call $lexIsSpace (local.get $c))))
                  (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
                    (then
                      (call $markoString (local.get $lineEnd))
                      (br $next)))
                  (br $value)))
              (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
              (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
              (br $next)))

          ;; text: a statement may start the line
          (if
            (i32.or
              (i32.eq (local.get $lhs) (global.get $srcBase))
              (i32.eq (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))) (i32.const 10)))
            (then
              (global.set $ptr (call $lexSkipSpaceAt (local.get $lhs)))
              (call $emitGap (local.get $lhs) (global.get $ptr))
              (local.set $p (global.get $ptr))
              (local.set $c (call $templateByte (local.get $p)))
              ;; `$ code` scriptlets
              (if
                (i32.and
                  (i32.eq (local.get $c) (i32.const "$"))
                  (call $lexIsSpace (call $templateByte (i32.add (local.get $p) (i32.const 1)))))
                (then
                  (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                  (call $emitTok (enum.get $Token.punctuation.special) (local.get $p) (global.get $ptr))
                  (local.set $mode (i32.shl (call $embedJsLine (local.get $lineEnd) (i32.const 1) (i32.const 0)) (i32.const 2)))
                  (br $next)))
              ;; `import`, `export`, `static`, `class`, `server`, `client`, and
              ;; `style {}` at the root
              (if (i32.and (i32.eq (local.get $p) (local.get $lhs)) (call $lexIsIdentStart (local.get $c)))
                (then
                  (call $scanIdentRun (i32.const "_"))
                  (local.set $q (global.get $ptr))
                  (local.set $c2 (call $templateByte (local.get $q)))
                  ;; the word, when it has at most six bytes
                  (local.set $w
                    (select
                      (i64.and
                        (i64.load (local.get $p))
                        (i64.sub
                          (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (i32.sub (local.get $q) (local.get $p)) (i32.const 3))))
                          (i64.const 1)))
                      (i64.const 0)
                      (i32.le_u (i32.sub (local.get $q) (local.get $p)) (i32.const 6))))
                  (if (i64.eq (local.get $w) (i64.const "style"))
                    (then
                      (local.set $c (i32.const 0))
                      (if (i32.eq (local.get $c2) (i32.const "."))
                        (then
                          (global.set $ptr (i32.add (local.get $q) (i32.const 1)))
                          (call $scanIdentRun (i32.const "-"))
                          (if (i32.eq (i32.sub (global.get $ptr) (local.get $q)) (i32.const 5))
                            (then
                              (local.set $c (i32.load offset=1 (local.get $q)))
                              (local.set $c
                                (i32.or
                                  (i32.eq (local.get $c) (i32.const "less"))
                                  (i32.shl (i32.eq (local.get $c) (i32.const "scss")) (i32.const 1))))))))
                      (local.set $c2 (call $lexSkipSpaceAt (global.get $ptr)))
                      (if (i32.eq (call $templateByte (local.get $c2)) (i32.const "{"))
                        (then
                          (call $emitTok (enum.get $Token.keyword) (local.get $p) (local.get $q))
                          (call $emitTok (enum.get $Token.attribute) (local.get $q) (global.get $ptr))
                          (call $emitGap (global.get $ptr) (local.get $c2))
                          (global.set $ptr (local.get $c2))
                          ;; CSS sees the `{`, so its depth ends the block
                          (local.set $css
                            (call $embedCssLine
                              (local.get $lineEnd)
                              (i32.or (i32.const 256) (i32.shl (local.get $c) (i32.const 28)))))
                          (local.set $mode (select (i32.const 5) (i32.const 0) (i32.and (local.get $css) (i32.const 0x0ffffe00))))
                          (br $next)))))
                  (global.set $ptr (local.get $p))
                  (if
                    (i32.and
                      (i32.or (call $lexIsSpace (local.get $c2)) (i32.eq (local.get $c2) (i32.const "{")))
                      (i32.or
                        (i32.or
                          (i32.or (i64.eq (local.get $w) (i64.const "import")) (i64.eq (local.get $w) (i64.const "export")))
                          (i32.or (i64.eq (local.get $w) (i64.const "static")) (i64.eq (local.get $w) (i64.const "class"))))
                        (i32.or (i64.eq (local.get $w) (i64.const "server")) (i64.eq (local.get $w) (i64.const "client")))))
                    (then
                      (local.set $mode (i32.shl (call $embedJsLine (local.get $lineEnd) (i32.const 1) (i32.const 0)) (i32.const 2)))
                      (br $next)))))))
          (local.set $lhs (global.get $ptr))
          (local.set $p (call $tmplFind4 (local.get $lhs) (i32.const "<") (i32.const "&") (i32.const "$") (i32.const 10)))
          (call $emitTok (enum.get $Token.none) (local.get $lhs) (local.get $p))
          (global.set $ptr (local.get $p))
          (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
          (local.set $c (i32.load8_u (local.get $p)))
          (local.set $c2 (call $templateByte (i32.add (local.get $p) (i32.const 1))))
          (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
          ;; a token, not a gap: a CR before it was text, so CRLF matches LF
          (if (i32.eq (local.get $c) (i32.const 10))
            (then
              (call $emitTok (enum.get $Token.none) (local.get $p) (global.get $ptr))
              (br $next)))
          (if (i32.eq (local.get $c) (i32.const "&"))
            (then
              (global.set $ptr (local.get $p))
              (if (i32.eqz (call $htmlEntity))
                (then
                  (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                  (call $emitTok (enum.get $Token.none) (local.get $p) (global.get $ptr))))
              (br $next)))
          ;; `${` and `$!{` placeholders
          (if (i32.eq (local.get $c) (i32.const "$"))
            (then
              (local.set $q
                (i32.add
                  (local.get $p)
                  (select
                    (i32.const 2)
                    (i32.const 3)
                    (i32.eq (local.get $c2) (i32.const "{")))))
              (if
                (i32.or
                  (i32.eq (local.get $c2) (i32.const "{"))
                  (i32.and
                    (i32.eq (local.get $c2) (i32.const "!"))
                    (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 2))) (i32.const "{"))))
                (then
                  (global.set $ptr (local.get $q))
                  (call $emitTok (enum.get $Token.punctuation.special) (local.get $p) (local.get $q))
                  (local.set $mode (i32.const 515))
                  (br $next)))
              (call $emitTok (enum.get $Token.none) (local.get $p) (global.get $ptr))
              (br $next)))
          ;; `<`: a comment, declaration, close tag, or start tag
          (if (i32.eq (local.get $c2) (i32.const "!"))
            (then
              (if
                (i32.and
                  (i32.le_u (i32.add (local.get $p) (i32.const 4)) (global.get $end))
                  (i32.eq (i32.load (local.get $p)) (i32.const "<!--")))
                (then (call $htmlComment (local.get $p)))
                (else (call $htmlDecl (local.get $p) (i32.const 0) (enum.get $Token.tag.doctype))))
              (br $next)))
          (if (i32.eq (local.get $c2) (i32.const "?"))
            (then
              (call $htmlDecl (local.get $p) (i32.const 1) (enum.get $Token.comment))
              (br $next)))
          (local.set $q (i32.add (local.get $p) (i32.const 1)))
          (if (i32.eq (local.get $c2) (i32.const "/"))
            (then
              (local.set $q (i32.add (local.get $q) (i32.const 1)))
              (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $p) (local.get $q))
              (global.set $ptr (i32.add (local.get $q) (i32.eq (call $templateByte (local.get $q)) (i32.const "@"))))
              (call $scanIdentRun (i32.const "-"))
              (call $markoTagName (local.get $q) (global.get $ptr))
              (local.set $q (call $lexSkipSpaceAt (global.get $ptr)))
              (if (i32.eq (call $templateByte (local.get $q)) (i32.const ">"))
                (then
                  (call $emitGap (global.get $ptr) (local.get $q))
                  (global.set $ptr (i32.add (local.get $q) (i32.const 1)))
                  (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $q) (global.get $ptr))))
              (br $next)))
          (if
            (i32.or
              (call $lexIsIdentStart (local.get $c2))
              (i32.or (i32.eq (local.get $c2) (i32.const "@")) (i32.eq (local.get $c2) (i32.const "$"))))
            (then
              (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $p) (local.get $q))
              ;; a dynamic tag `<${expr}>`
              (if
                (i32.and
                  (i32.eq (local.get $c2) (i32.const "$"))
                  (i32.eq (call $templateByte (i32.add (local.get $q) (i32.const 1))) (i32.const "{")))
                (then
                  (global.set $ptr (i32.add (local.get $q) (i32.const 2)))
                  (call $emitTok (enum.get $Token.punctuation.special) (local.get $q) (global.get $ptr))
                  (local.set $mode (i32.const 771))
                  (br $next)))
              (global.set $ptr (i32.add (local.get $q) (i32.eq (local.get $c2) (i32.const "@"))))
              (call $scanIdentRun (i32.const "-"))
              (call $markoTagName (local.get $q) (global.get $ptr))
              (local.set $mode
                (i32.or (i32.const 1) (i32.shl (call $rawTextKind (local.get $q) (global.get $ptr)) (i32.const 16))))
              (br $next)))
          (call $emitTok (enum.get $Token.none) (local.get $p) (global.get $ptr))
          (br $next))

        ;; a JavaScript value at $ptr, ending on this line or going on
        (local.set $lhs (global.get $ptr))
        (local.set $p
          (call $markoValueEnd
            (local.get $lhs)
            (local.get $lineEnd)
            (select (local.get $value) (i32.const 0) (i32.eq (i32.and (local.get $mode) (i32.const 255)) (i32.const 2)))))
        (drop
          (call $embedJsLine
            (local.get $p)
            (i32.ne (i32.and (local.get $mode) (i32.const 255)) (i32.const 2))
            (i32.const 0)))
        (local.set $value (global.get $markoValueState))
        (local.set $mode
          (i32.or
            (i32.and (local.get $mode) (i32.const -256))
            (select (i32.const 2) (i32.const 1) (local.get $value))))
        (br $next))))
)
