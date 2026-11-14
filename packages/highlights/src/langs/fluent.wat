(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (import "@pierre/wat-tools/common.wat")
  (import "./ini.wat")

  ;; Emit a variant key at $ptr: an optional `*` default marker, then
  ;; `[key]` on one line. The key is a number or a name.
  (func $fluentVariantKey
    (local $lhs i32)
    (local $p i32)
    (local.set $lhs (global.get $ptr))
    (if (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "*"))
      (then
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
        (local.set $lhs (global.get $ptr))))
    (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
    (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
    (local.set $lhs (call $lexSkipSpaceAt (global.get $ptr)))
    (call $emitGap (global.get $ptr) (local.get $lhs))
    (local.set $p
      (call $scanFindSpecial (local.get $lhs) (global.get $end) (i32.const "]") (i32.const 0) (i32.const 1)))
    (global.set $ptr (local.get $p))
    (local.set $p (call $iniTrim (local.get $lhs) (local.get $p)))
    (call $emitTok
      (select
        (enum.get $Token.number)
        (enum.get $Token.label)
        (call $lexIsDigit (call $templateByte (local.get $lhs))))
      (local.get $lhs)
      (local.get $p))
    (call $emitGap (local.get $p) (global.get $ptr))
    (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "]"))
      (then
        (local.set $lhs (global.get $ptr))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr)))))

  ;; Fluent (FTL) localization files. A line that starts at column 0 with a
  ;; letter, `-`, or `#` starts a message, a term, or a comment; indented lines
  ;; continue the value or hold `.attr =` attributes. Values are text with
  ;; `{ }` placeables. $depth counts open placeables; bit d - 1 of $variants
  ;; is set while placeable d holds the variants of a `->` selector, whose
  ;; values are text again.
  (func $hlFluent
    (local $c i32)
    (local $gap i32)
    (local $lhs i32)
    (local $p i32)
    (local $first i32)
    (local $depth i32)
    (local $variants i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $first (i32.eqz (call $lexLineByteBefore (local.get $lhs))))
        ;; column 0: a comment, message, or term starts a new entry
        (if
          (i32.and
            (local.get $first)
            (i32.and
              (i32.or
                (i32.eq (local.get $lhs) (global.get $srcBase))
                (i32.le_u (i32.sub (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))) (i32.const 10)) (i32.const 3)))
              (i32.or
                (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
                (i32.or (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c) (i32.const "#"))))))
          (then
            (local.set $depth (i32.const 0))
            (local.set $variants (i32.const 0))
            (if (i32.eq (local.get $c) (i32.const "#"))
              (then
                (call $lexLineComment
                  (i32.const 1)
                  (select
                    (enum.get $Token.comment.doc)
                    (enum.get $Token.comment)
                    (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 1))) (i32.const "#"))))
                (br $next)))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const "-"))
            (call $emitTok
              (select (enum.get $Token.constant) (enum.get $Token.property) (i32.eq (local.get $c) (i32.const "-")))
              (local.get $lhs)
              (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "="))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if
          (i32.or
            (i32.eqz (local.get $depth))
            (i32.and
              (i32.shr_u (local.get $variants) (i32.sub (local.get $depth) (i32.const 1)))
              (i32.const 1)))
          (then
            ;; text: attributes and variant keys start a line; `{` opens a
            ;; placeable, and `}` closes the selector that holds the variants
            (if (i32.and (local.get $first) (i32.eqz (local.get $depth)))
              (then
                (if (i32.eq (local.get $c) (i32.const "."))
                  (then
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                    (call $scanIdentRun (i32.const "-"))
                    (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
                    (br $next)))))
            (if
              (i32.and
                (i32.ne (local.get $depth) (i32.const 0))
                (i32.or
                  (i32.and (local.get $first) (i32.eq (local.get $c) (i32.const "[")))
                  (i32.and
                    (i32.eq (local.get $c) (i32.const "*"))
                    (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 1))) (i32.const "[")))))
              (then
                (call $fluentVariantKey)
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const "{"))
              (then
                (local.set $variants
                  (i32.and (local.get $variants) (i32.rotl (i32.const -2) (local.get $depth))))
                (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (if (i32.and (i32.eq (local.get $c) (i32.const "}")) (i32.ne (local.get $depth) (i32.const 0)))
              (then
                (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (local.set $p
              (call $scanFindSpecial (local.get $lhs) (global.get $end) (i32.const "{") (i32.const 0) (i32.const 1)))
            (if (local.get $depth)
              (then
                (local.set $p
                  (call $scanFindSpecial (local.get $lhs) (local.get $p) (i32.const "}") (i32.const 0) (i32.const 0)))
                ;; `*[` starts the default variant
                (local.set $gap (local.get $lhs))
                (block $starDone
                  (loop $star
                    (local.set $gap
                      (call $scanFindSpecial (i32.add (local.get $gap) (i32.const 1)) (local.get $p) (i32.const "*") (i32.const 0) (i32.const 0)))
                    (br_if $starDone (i32.ge_u (local.get $gap) (local.get $p)))
                    (br_if $star
                      (i32.ne (call $templateByte (i32.add (local.get $gap) (i32.const 1))) (i32.const "[")))
                    (local.set $p (local.get $gap))))))
            ;; trailing blanks stay a gap
            (local.set $p (call $iniTrim (local.get $lhs) (local.get $p)))
            (global.set $ptr (local.get $p))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (local.get $p))
            (br $next)))
        ;; inside a placeable
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (if (i32.eq (local.get $c) (i32.const "{"))
          (then
            (local.set $variants
              (i32.and (local.get $variants) (i32.rotl (i32.const -2) (local.get $depth))))
            (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "}"))
          (then
            (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (local.set $gap (local.get $lhs))
            (block $strDone
              (loop $str
                (local.set $p
                  (call $scanFindSpecial (global.get $ptr) (global.get $end) (i32.const 34) (i32.const 1) (i32.const 1)))
                (global.set $ptr (local.get $p))
                (br_if $strDone (i32.ge_u (local.get $p) (global.get $end)))
                (local.set $c (i32.load8_u (local.get $p)))
                (if (i32.eq (local.get $c) (i32.const 34))
                  (then
                    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                    (br $strDone)))
                (br_if $strDone (i32.ne (local.get $c) (i32.const 92)))
                (call $emitTok (enum.get $Token.string) (local.get $gap) (local.get $p))
                (local.set $c (call $templateByte (i32.add (local.get $p) (i32.const 1))))
                (local.set $gap
                  (if (result i32) (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "u"))
                    (then
                      (call $scanHexRun
                        (i32.add (local.get $p) (i32.const 2))
                        (select (i32.const 6) (i32.const 4) (i32.eq (local.get $c) (i32.const "U")))))
                    (else
                      (select
                        (i32.add (local.get $p) (i32.const 1))
                        (call $lexEscapeEnd (local.get $p))
                        (i32.or (i32.eqz (local.get $c)) (byteset.get "\n\r" (local.get $c)))))))
                (call $emitTok (enum.get $Token.string.escape) (local.get $p) (local.get $gap))
                (global.set $ptr (local.get $gap))
                (br $str)))
            (call $emitTok (enum.get $Token.string) (local.get $gap) (global.get $ptr))
            (br $next)))
        (local.set $p (call $templateByte (global.get $ptr)))
        (if
          (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $p) (i32.const ">")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $variants
              (i32.or (local.get $variants) (i32.shl (i32.const 1) (i32.sub (local.get $depth) (i32.const 1)))))
            ;; a variant can follow `->` on the same line
            (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
            (call $emitGap (global.get $ptr) (local.get $p))
            (global.set $ptr (local.get $p))
            (local.set $c (call $templateByte (global.get $ptr)))
            (if
              (i32.or
                (i32.eq (local.get $c) (i32.const "["))
                (i32.and
                  (i32.eq (local.get $c) (i32.const "*"))
                  (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "["))))
              (then (call $fluentVariantKey)))
            (br $next)))
        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const "-")) (call $lexIsDigit (local.get $p))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.eq (local.get $c) (i32.const "-"))))
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if
          (i32.and
            (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "$")) (i32.eq (local.get $c) (i32.const "-")))
              (i32.eq (local.get $c) (i32.const ".")))
            (call $lexIsNameStart (local.get $p)))
          (then
            (call $scanIdentRun (i32.const "-"))
            (call $emitTok
              (select
                (enum.get $Token.variable)
                (select (enum.get $Token.constant) (enum.get $Token.attribute) (i32.eq (local.get $c) (i32.const "-")))
                (i32.eq (local.get $c) (i32.const "$")))
              (local.get $lhs)
              (global.get $ptr))
            (br $next)))
        (if (call $lexIsNameStart (local.get $c))
          (then
            ;; FUNC( is a call, name: a named argument, else a message
            (call $scanIdentRun (i32.const "-"))
            (local.set $p (call $templateByte (call $lexSkipSpaceAt (global.get $ptr))))
            (call $emitTok
              (select
                (enum.get $Token.function)
                (select (enum.get $Token.variable.parameter) (enum.get $Token.property) (i32.eq (local.get $p) (i32.const ":")))
                (i32.eq (local.get $p) (i32.const "(")))
              (local.get $lhs)
              (global.get $ptr))
            (br $next)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ":")))
          (then
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
