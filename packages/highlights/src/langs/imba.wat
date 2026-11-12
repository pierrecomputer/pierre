(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (memory-region $mem.imbaWords 256)

  (import "@pierre/wat-tools/common.wat")
  (import "./coffee.wat")

  ;; WARNING: Imba gets its own copy of the CoffeeScript regex scan. With two
  ;; callers Binaryen stops inlining $coffeeRegex into the CoffeeScript lexer.
  (func-variant $imbaRegex $coffeeRegex)

  ;; Token in the low seven bits. Bits 7-8: a `/` after the word is 0 a regex,
  ;; 1 a division. Bits 9-11: the next name is 1 a function, 2 a class, 3 a
  ;; property; 4 starts a style block; 5 opens `do` parameters.
  (keyword-table $imbaWords $mem.imbaWords $mem.imbaWords+256
    (group $Token.keyword.control
      "if" "elif" "else" "unless" "for" "in" "of" "while" "until" "loop" "switch" "when" "then"
      "try" "catch" "finally" "return" "break" "continue" "await" "yield" "throw")
    (group $Token.keyword.control+2560 "do")
    (group $Token.keyword.declaration+512 "def" "get" "set")
    (group $Token.keyword.declaration+1024 "class" "tag")
    (group $Token.keyword.declaration+1536 "prop" "attr")
    (group $Token.keyword.declaration+2048 "css")
    (group $Token.keyword.declaration "extend" "let" "const" "var" "static" "declare")
    (group $Token.keyword.import "import" "export" "from" "as" "default")
    (group $Token.keyword.operator "new" "delete" "typeof" "isa" "and" "or" "not" "is" "isnt")
    (group $Token.boolean+128 "true" "false" "yes" "no")
    (group $Token.constant.builtin+128 "null" "undefined")
    (group $Token.variable.special+128 "self" "this" "super" "global"))

  ;; Scan an Imba name from $ptr: identifier bytes and inner dashes
  ;; (`app-header`), but not a trailing dash (`x--`).
  (func $imbaName
    (call $scanIdentRun (i32.const "-"))
    (block $done
      (loop $trim
        (br_if $done (i32.ne (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const "-")))
        (global.set $ptr (i32.sub (global.get $ptr) (i32.const 1)))
        (br $trim))))

  ;; $lq: the quote byte, plus 256 for `'''` or `"""`. Double quotes and
  ;; backticks interpolate `{...}`. Returns 1 past the closer, 2 past `{`, 0
  ;; at $end.
  (func $imbaLiteral (param $lq i32) (result i32)
    (local $c i32)
    (local $e i32)
    (local $q i32)
    (local $seg i32)
    (local.set $q (i32.and (local.get $lq) (i32.const 255)))
    (local.set $seg (global.get $ptr))
    (block $done
      (result i32)
      (loop $scan
        (result i32)
        (global.set $ptr
          (call $scanFind3
            (global.get $ptr)
            (local.get $q)
            (i32.const 92)
            (select (local.get $q) (i32.const "{") (i32.eq (local.get $q) (i32.const 39)))))
        (if (i32.ge_u (global.get $ptr) (global.get $end))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (br $done (i32.const 0))))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $e (call $lexEscapeEnd (global.get $ptr)))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (local.get $e))
            (br $scan)))
        (if (i32.eq (local.get $c) (i32.const "{"))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $seg) (global.get $ptr))
            (br $done (i32.const 2))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (if (i32.shr_u (local.get $lq) (i32.const 8))
          (then
            (br_if $scan
              (i32.or
                (i32.ne (call $templateByte (global.get $ptr)) (local.get $q))
                (i32.ne (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (local.get $q))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))))
        (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
        (i32.const 1))))

  ;; One token of a style block or of `[...]` tag modifiers, as Imba reads
  ;; them: a name before `:` is a property (`bg@hover:`), and the values run to
  ;; the next property. $value: 0 in the selector before the first property.
  ;; Returns the new $value.
  (func $imbaCss (param $value i32) (result i32)
    (local $c i32)
    (local $c2 i32)
    (local $hl i32)
    (local $lhs i32)
    (local $p i32)
    (local.set $lhs (global.get $ptr))
    (local.set $c (i32.load8_u (local.get $lhs)))
    (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
    (local.set $p (local.get $lhs))
    (block $name
      (loop $run
        (br_if $name (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $hl (i32.load8_u (local.get $p)))
        (br_if $name
          (i32.eqz
            (byteset.get "!$%-.0123456789@ABCDEFGHIJKLMNOPQRSTUVWXYZ^_abcdefghijklmnopqrstuvwxyz"
              (local.get $hl))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $run)))
    (if
      (i32.and
        (i32.gt_u (local.get $p) (local.get $lhs))
        (i32.and
          (i32.eq (call $templateByte (local.get $p)) (i32.const ":"))
          (i32.ne (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const ":"))))
      (then
        (call $emitTok (enum.get $Token.property) (local.get $lhs) (local.get $p))
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $p) (global.get $ptr))
        (return (i32.const 1))))
    (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
    (block $emit
      (if (local.get $value)
        (then
          (if
            (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and
                (i32.or (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c) (i32.const "-")))
                (call $lexIsDigit (local.get $c2))))
            (then
              (call $lexScanNumber)
              (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "%"))
                (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
              (local.set $hl (enum.get $Token.number))
              (br $emit)))
          (if (i32.eq (local.get $c) (i32.const "#"))
            (then
              (call $lexScanIdent)
              (local.set $hl (enum.get $Token.string.special))
              (br $emit)))
          (if
            (i32.or
              (i32.eq (local.get $c) (i32.const "$"))
              (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c2) (i32.const "-"))))
            (then
              (call $imbaName)
              (local.set $hl (enum.get $Token.variable))
              (br $emit)))
          (if (call $lexIsIdentStart (local.get $c))
            (then
              (call $imbaName)
              (local.set $hl
                (select
                  (enum.get $Token.function)
                  (enum.get $Token.constant.builtin)
                  (i32.eq (call $templateByte (global.get $ptr)) (i32.const "("))))
              (br $emit))))
        (else
          (if (i32.or (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c) (i32.const "%")))
            (then
              (call $imbaName)
              (local.set $hl (enum.get $Token.selector.class))
              (br $emit)))
          (if (i32.eq (local.get $c) (i32.const "#"))
            (then
              (call $imbaName)
              (local.set $hl (enum.get $Token.selector.id))
              (br $emit)))
          (if (i32.or (i32.eq (local.get $c) (i32.const "@")) (i32.eq (local.get $c) (i32.const ":")))
            (then
              (if (i32.eq (local.get $c2) (i32.const ":"))
                (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
              (call $imbaName)
              (local.set $hl (enum.get $Token.selector.pseudo))
              (br $emit)))
          (if (call $lexIsIdentStart (local.get $c))
            (then
              (call $imbaName)
              (local.set $hl (enum.get $Token.tag))
              (br $emit)))))
      (local.set $hl (enum.get $Token.punctuation.bracket))
      (br_if $emit (byteset.get "()[]{}" (local.get $c)))
      (local.set $hl (enum.get $Token.punctuation.delimiter))
      (br_if $emit (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";"))))
      (local.set $hl (enum.get $Token.operator))
      (br_if $emit (byteset.get "!%&*+-/<=>?^|~" (local.get $c)))
      (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
      (local.set $hl (enum.get $Token.none)))
    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
    (local.get $value))

  ;; State that crosses lines: $lq the open string (see $imbaLiteral), $iq the
  ;; string an interpolation suspends, $depth its open braces, $css the indent
  ;; + 1 of the open style block, and $tag the open tag literal: bits 0-1 are 1
  ;; at an attribute, 2 in an attribute value, 3 before the tag name; bit 2 is
  ;; set inside `[...]` modifiers; bits 8+ count the value's open brackets.
  ;; Each line resets $prev (a `/` is 0 a regex, 1 a division, 2 a regex only
  ;; when spaced), $member, $decl (what the next name declares), $params (1 a
  ;; `(` list, 2 a `|` list, 3 to the line end, 4 before a list) with $param
  ;; (the next name is one), $value (past the first property of a style line),
  ;; and $indent. A string that spans lines keeps them, so they are saved too.
  (func $hlImba
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $hl i32)
    (local $lhs i32)
    (local $p i32)
    (local $v i32)
    (local $lq i32)
    (local $iq i32)
    (local $depth i32)
    (local $css i32)
    (local $tag i32)
    (local $bol i32)
    (local $indent i32)
    (local $prev i32)
    (local $member i32)
    (local $decl i32)
    (local $params i32)
    (local $param i32)
    (local $value i32)
    (call $lexEmitLeadingContinuation)
    ;; a run starts a line unless it resumes a string
    (local.set $bol (i32.eqz (local.get $lq)))
    (block $done
      (loop $next
        (block $tok
        (if (local.get $lq)
          (then
            (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $v (call $imbaLiteral (local.get $lq)))
            (br_if $done (i32.eqz (local.get $v)))
            (if (i32.eq (local.get $v) (i32.const 2))
              (then
                (local.set $iq (local.get $lq))
                (local.set $depth (i32.const 0))
                (local.set $prev (i32.const 0)))
              (else (local.set $prev (i32.const 1))))
            (local.set $lq (i32.const 0))
            (br $next)))
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        ;; a blank ends an attribute value
        (if
          (i32.and
            (i32.gt_u (global.get $ptr) (local.get $gap))
            (i32.eq (i32.and (local.get $tag) (i32.const -253)) (i32.const 2)))
          (then (local.set $tag (i32.xor (local.get $tag) (i32.const 3)))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        ;; the first token of a line: its indent may close a style block
        (if (i32.or (local.get $bol) (call $lexGapHasBreak (local.get $gap) (global.get $ptr)))
          (then
            (local.set $p (global.get $ptr))
            (block $start
              (loop $back
                (br_if $start (i32.le_u (local.get $p) (local.get $gap)))
                (local.set $c (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))
                (br_if $start (byteset.get "\n\r" (local.get $c)))
                (local.set $p (i32.sub (local.get $p) (i32.const 1)))
                (br $back)))
            (local.set $indent (i32.sub (global.get $ptr) (local.get $p)))
            (if (i32.lt_u (local.get $indent) (local.get $css))
              (then (local.set $css (i32.const 0))))
            (local.set $bol (i32.const 0))
            (local.set $prev (i32.const 0))
            (local.set $member (i32.const 0))
            (local.set $decl (i32.const 0))
            (local.set $params (i32.const 0))
            (local.set $param (i32.const 0))
            (local.set $value (i32.const 0))))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))

        ;; comments: `# `, `###` blocks, `//`, `/* */`
        (if
          (i32.or
            (i32.and
              (i32.eq (local.get $c) (i32.const "#"))
              (i32.or
                (call $lexIsSpace (local.get $c2))
                (i32.or
                  (i32.or (i32.eq (local.get $c2) (i32.const "#")) (i32.eq (local.get $c2) (i32.const "!")))
                  (i32.ge_u (global.get $ptr) (global.get $end)))))
            (i32.and
              (i32.eq (local.get $c) (i32.const "/"))
              (i32.or (i32.eq (local.get $c2) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))))
          (then
            (global.set $ptr (local.get $lhs))
            (if (i32.eq (local.get $c2) (i32.const "*"))
              (then
                (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
                (br $next)))
            (if
              (i32.and
                (i32.eq (local.get $c2) (i32.const "#"))
                (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "#")))
              (then
                (local.set $p (i32.add (local.get $lhs) (i32.const 3)))
                (local.set $v (i32.const 0))
                (block $closed
                  (loop $find
                    (local.set $p (call $lexFindByte (local.get $p) (i32.const "#")))
                    (br_if $closed (i32.ge_u (local.get $p) (global.get $end)))
                    (if
                      (i32.and
                        (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const "#"))
                        (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 2))) (i32.const "#")))
                      (then
                        (local.set $p (i32.add (local.get $p) (i32.const 3)))
                        (local.set $v (i32.const 1))
                        (br $closed)))
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br $find)))
                (global.set $ptr (local.get $p))
                (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
                (if (i32.eqz (local.get $v))
                  (then (call $streamSetFixed32 (i32.const "###") (i32.const 3) (enum.get $Token.comment))))
                (br $next)))
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))

        (if (i32.and (i32.ne (local.get $iq) (i32.const 0)) (i32.eq (local.get $c) (i32.const "}")))
          (then
            (if (i32.eqz (local.get $depth))
              (then
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                (local.set $lq (local.get $iq))
                (local.set $iq (i32.const 0))
                (br $next)))
            (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))))

        ;; inside a tag literal, before its name or at an attribute
        (if (i32.and (local.get $tag) (i32.const 4))
          (then
            (if (i32.eq (local.get $c) (i32.const "]"))
              (then
                (local.set $tag (i32.xor (local.get $tag) (i32.const 4)))
                (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (if (i32.and (i32.ne (local.get $c) (i32.const 34)) (i32.ne (local.get $c) (i32.const 39)))
              (then
                (global.set $ptr (local.get $lhs))
                (drop (call $imbaCss (i32.const 1)))
                (br $next)))))
        (if (i32.and (local.get $tag) (i32.const 1))
          (then
            (local.set $v (i32.and (local.get $tag) (i32.const 3)))
            (local.set $tag (i32.or (i32.and (local.get $tag) (i32.const -4)) (i32.const 1)))
            (if (i32.eq (local.get $c) (i32.const ">"))
              (then
                (local.set $tag (i32.const 0))
                (local.set $prev (i32.const 1))
                (local.set $hl (enum.get $Token.punctuation.bracket.html))
                (br $tok)))
            (if (i32.eq (local.get $c) (i32.const "["))
              (then
                (local.set $tag (i32.or (local.get $tag) (i32.const 4)))
                (local.set $hl (enum.get $Token.punctuation.bracket))
                (br $tok)))
            (if (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "(")))
              (then
                (local.set $tag (i32.const 0x102))
                (local.set $prev (i32.const 0))
                (local.set $hl (enum.get $Token.punctuation.bracket))
                (br $tok)))
            (if (i32.eq (local.get $c) (i32.const "="))
              (then
                (local.set $tag (i32.const 2))
                (local.set $prev (i32.const 0))
                (local.set $hl (enum.get $Token.operator))
                (br $tok)))
            ;; `.class`, `%mixin`, `#id`, `$ref`, and `@event.modifier`
            (if
              (i32.and
                (call $lexIsIdentContinue (local.get $c2))
                (byteset.get "#$%.@" (local.get $c)))
              (then
                (local.set $hl (enum.get $Token.selector.class))
                (if (i32.eq (local.get $c) (i32.const "#"))
                  (then (local.set $hl (enum.get $Token.selector.id))))
                (if (i32.eq (local.get $c) (i32.const "$"))
                  (then (local.set $hl (enum.get $Token.variable.special))))
                (if (i32.eq (local.get $c) (i32.const "@"))
                  (then (local.set $hl (enum.get $Token.attribute))))
                (block $mods
                  (loop $mod
                    (call $imbaName)
                    (br_if $mods
                      (i32.or
                        (i32.ne (local.get $c) (i32.const "@"))
                        (i32.ne (call $templateByte (global.get $ptr)) (i32.const "."))))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $mod)))
                (br $tok)))
            (if (call $lexIsIdentStart (local.get $c))
              (then
                (call $imbaName)
                (local.set $hl
                  (select (enum.get $Token.tag) (enum.get $Token.attribute) (i32.eq (local.get $v) (i32.const 3))))
                (br $tok)))))

        ;; a style block's line
        (if
          (i32.and
            (i32.ne (local.get $css) (i32.const 0))
            (i32.and (i32.ne (local.get $c) (i32.const 34)) (i32.ne (local.get $c) (i32.const 39))))
          (then
            (global.set $ptr (local.get $lhs))
            (local.set $value (call $imbaCss (local.get $value)))
            (br $next)))

        (if
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
            (i32.eq (local.get $c) (i32.const "`")))
          (then
            (local.set $lq (local.get $c))
            (if
              (i32.and
                (i32.eq (local.get $c2) (local.get $c))
                (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (local.get $c)))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))
                (local.set $lq (i32.or (local.get $c) (i32.const 256)))))
            (local.set $hl (enum.get $Token.string))
            (br $tok)))

        (if (i32.eq (local.get $c) (i32.const "/"))
          (then
            (if
              (i32.or
                (i32.eqz (local.get $prev))
                (i32.and
                  (i32.eq (local.get $prev) (i32.const 2))
                  (i32.and
                    (i32.gt_u (local.get $lhs) (local.get $gap))
                    (i32.eqz (call $lexIsSpace (local.get $c2))))))
              (then
                (global.set $ptr (local.get $lhs))
                (if (i32.or (call $imbaRegex) (i32.eqz (local.get $prev)))
                  (then
                    (local.set $hl (enum.get $Token.string.regex))
                    (local.set $prev (i32.const 1))
                    (br $tok)))
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))))))

        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (global.set $ptr (local.get $lhs))
            (call $lexScanNumber)
            ;; a unit: `10px`, `2s`, `50%`
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "%"))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (local.set $hl (enum.get $Token.number))
            (local.set $prev (i32.const 1))
            (br $tok)))

        ;; `@name` instance variables and decorators, `#name` private names
        (if
          (i32.and
            (i32.or (i32.eq (local.get $c) (i32.const "@")) (i32.eq (local.get $c) (i32.const "#")))
            (call $lexIsIdentStart (local.get $c2)))
          (then
            (call $imbaName)
            (local.set $hl (enum.get $Token.variable.special))
            (local.set $prev (i32.const 1))
            (local.set $member (i32.const 0))
            (br $tok)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $imbaName)
            ;; the `!` call suffix
            (if
              (i32.and
                (i32.eq (call $templateByte (global.get $ptr)) (i32.const "!"))
                (i32.ne (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "=")))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (local.set $prev (i32.const 2))
            (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
            (local.set $c2 (call $templateByte (local.get $p)))
            (local.set $v (i32.const -1))
            (if (i32.eqz (local.get $member))
              (then (local.set $v (keyword-table.value $imbaWords (local.get $lhs) (global.get $ptr)))))
            ;; a declaring word needs a name after it, and `css` a blank
            (local.set $hl (i32.shr_u (local.get $v) (i32.const 9)))
            (if (i32.le_u (i32.sub (local.get $hl) (i32.const 1)) (i32.const 3))
              (then
                (if
                  (i32.eqz
                    (select
                      (i32.and
                        (i32.gt_u (local.get $p) (global.get $ptr))
                        (i32.and (i32.ne (local.get $c2) (i32.const "=")) (i32.ne (local.get $c2) (i32.const ":"))))
                      (call $lexIsIdentStart (local.get $c2))
                      (i32.eq (local.get $hl) (i32.const 4))))
                  (then (local.set $v (i32.const -1))))))
            (if (i32.ne (local.get $v) (i32.const -1))
              (then
                (local.set $hl (i32.and (local.get $v) (i32.const 127)))
                (local.set $prev (i32.and (i32.shr_u (local.get $v) (i32.const 7)) (i32.const 3)))
                (local.set $decl (i32.shr_u (local.get $v) (i32.const 9)))
                (if (i32.eq (local.get $decl) (i32.const 4))
                  (then
                    (local.set $css (i32.add (local.get $indent) (i32.const 1)))
                    (local.set $value (i32.const 0))))
                (if (i32.eq (local.get $decl) (i32.const 5))
                  (then (local.set $params (i32.const 4))))
                (local.set $param (i32.const 0))
                (br $tok)))
            (block $named
              (local.set $hl (enum.get $Token.function.definition))
              (if (i32.eq (local.get $decl) (i32.const 1))
                (then
                  (local.set $params
                    (select (i32.const 4) (i32.const 3) (i32.eq (call $templateByte (global.get $ptr)) (i32.const "("))))
                  (br $named)))
              (local.set $hl (enum.get $Token.type.class))
              (br_if $named (i32.eq (local.get $decl) (i32.const 2)))
              (local.set $hl (enum.get $Token.property))
              (br_if $named (i32.eq (local.get $decl) (i32.const 3)))
              (local.set $hl (enum.get $Token.variable.parameter))
              (br_if $named (local.get $param))
              ;; an object key
              (local.set $hl (enum.get $Token.property))
              (br_if $named
                (i32.and
                  (i32.eqz (local.get $member))
                  (i32.and
                    (i32.eq (call $templateByte (global.get $ptr)) (i32.const ":"))
                    (i32.ne (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const ":")))))
              ;; a call: `name(` or the `!` suffix
              (local.set $p
                (i32.or
                  (i32.eq (call $templateByte (global.get $ptr)) (i32.const "("))
                  (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const "!"))))
              (if (local.get $member)
                (then
                  (if (local.get $p)
                    (then (local.set $hl (enum.get $Token.function.method))))
                  (br $named)))
              (local.set $hl (enum.get $Token.constant))
              (br_if $named (call $lexIsConstCase (local.get $lhs) (global.get $ptr)))
              (local.set $hl (enum.get $Token.type))
              (br_if $named (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))
              (local.set $hl (enum.get $Token.function))
              (br_if $named (local.get $p))
              (local.set $hl
                (select (enum.get $Token.variable.special) (enum.get $Token.variable) (i32.eq (local.get $c) (i32.const "$")))))
            (local.set $param (i32.eq (local.get $decl) (i32.const 1)))
            ;; after a class name, `<` names the superclass
            (local.set $decl (select (i32.const 6) (i32.const 0) (i32.eq (local.get $decl) (i32.const 2))))
            (local.set $member (i32.const 0))
            (br $tok)))

        ;; a `:symbol`
        (if
          (i32.and
            (i32.and (i32.eq (local.get $c) (i32.const ":")) (call $lexIsIdentStart (local.get $c2)))
            (i32.or (i32.eqz (local.get $prev)) (i32.gt_u (local.get $lhs) (local.get $gap))))
          (then
            (call $imbaName)
            (local.set $hl (enum.get $Token.string.special.symbol))
            (local.set $prev (i32.const 1))
            (br $tok)))

        ;; a `\Type` annotation runs to a blank or a closing delimiter
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (block $typed
              (loop $type
                (br_if $typed (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c (i32.load8_u (global.get $ptr)))
                (br_if $typed (i32.or (call $lexIsSpace (local.get $c)) (byteset.get "),.=]}" (local.get $c))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $type)))
            (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
            (local.set $hl (enum.get $Token.type))
            (local.set $prev (i32.const 1))
            (br $tok)))

        ;; `<` before a name, `.`, `#`, `{`, or `[` opens a tag in operand position
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "<"))
            (i32.or
              (i32.eqz (local.get $prev))
              (i32.and (i32.eq (local.get $prev) (i32.const 2)) (i32.gt_u (local.get $lhs) (local.get $gap)))))
          (then
            (if
              (i32.or
                (i32.or (call $lexIsIdentStart (local.get $c2)) (byteset.get "#%.@[{" (local.get $c2)))
                (i32.eq (local.get $c2) (i32.const ">")))
              (then
                (local.set $tag (i32.const 3))
                (local.set $hl (enum.get $Token.punctuation.bracket.html))
                (br $tok)))))

        (local.set $v (local.get $prev))
        (local.set $prev (i32.const 0))
        (if (i32.and (i32.eq (local.get $decl) (i32.const 6)) (i32.eq (local.get $c) (i32.const "<")))
          (then
            (local.set $decl (i32.const 2))
            (local.set $hl (enum.get $Token.operator))
            (br $tok)))
        (local.set $decl (i32.const 0))
        (local.set $member (i32.const 0))
        (local.set $hl (enum.get $Token.punctuation.bracket))
        ;; `|x, y|` parameters
        (if (i32.and (i32.eq (local.get $c) (i32.const "|")) (i32.ge_u (local.get $params) (i32.const 2)))
          (then
            (local.set $param (i32.eq (local.get $params) (i32.const 4)))
            (local.set $params (select (i32.const 2) (i32.const 0) (local.get $param)))
            (br $tok)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (if (i32.and (i32.ne (local.get $iq) (i32.const 0)) (i32.eq (local.get $c) (i32.const "{")))
              (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
            ;; an attribute value's brackets
            (if (i32.eq (i32.and (local.get $tag) (i32.const 3)) (i32.const 2))
              (then
                (if (byteset.get "([{" (local.get $c))
                  (then (local.set $tag (i32.add (local.get $tag) (i32.const 256))))
                  (else
                    (if (i32.ge_u (local.get $tag) (i32.const 256))
                      (then (local.set $tag (i32.sub (local.get $tag) (i32.const 256)))))))))
            (if (byteset.get ")]}" (local.get $c))
              (then
                (local.set $prev (i32.const 2))
                (if (i32.eq (local.get $params) (i32.const 1))
                  (then (local.set $params (i32.const 0))))))
            (if (i32.and (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $params) (i32.const 4)))
              (then
                (local.set $params (i32.const 1))
                (local.set $param (i32.const 1))))
            (br $tok)))
        (if (i32.eq (local.get $params) (i32.const 4))
          (then (local.set $params (i32.const 0))))
        (local.set $param (i32.const 0))
        ;; a tag ends at `>` outside its attribute value's brackets
        (if (i32.and (i32.eq (local.get $c) (i32.const ">")) (i32.eq (local.get $tag) (i32.const 2)))
          (then
            (local.set $tag (i32.const 0))
            (local.set $prev (i32.const 1))
            (local.set $hl (enum.get $Token.punctuation.bracket.html))
            (br $tok)))
        (local.set $hl (enum.get $Token.punctuation.delimiter))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (local.set $param (i32.ne (local.get $params) (i32.const 0)))
            (br $tok)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (if (i32.eq (local.get $c2) (i32.const "."))
              (then
                (global.set $ptr
                  (i32.add
                    (global.get $ptr)
                    (i32.add
                      (i32.const 1)
                      (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const ".")))))
                (local.set $hl (enum.get $Token.operator))
                (br $tok)))
            (local.set $member (i32.const 1))
            (br $tok)))
        (br_if $tok (i32.eq (local.get $c) (i32.const ":")))
        (if (byteset.get "!%&*+-/<=>?^|~" (local.get $c))
          (then
            (block $opDone
              (loop $op
                (local.set $c (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eqz (byteset.get "!%&*+-/<=>?^|~" (local.get $c))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            ;; `?.` keeps the operand before it
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "."))
              (then (local.set $prev (local.get $v))))
            (local.set $hl (enum.get $Token.operator))
            (br $tok)))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (local.set $hl (enum.get $Token.none)))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
