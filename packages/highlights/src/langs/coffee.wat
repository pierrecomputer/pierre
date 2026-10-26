(module
  (import "../common.wat")
  (import "./tsx.wat")

  ;; Token in the low seven bits. Bits 7-8: a `/` after the word is 0 a regex, 1 a
  ;; division, 2 a regex only when spaced. Bit 9: the next name is a class, bit 10
  ;; a type.
  (keyword-table $coffeeWords $mem.coffeeWords $mem.nginxWords
    (group $Token.keyword.control
      "if" "do" "in" "of" "by" "for" "own" "try" "else" "then" "when" "loop" "while" "until"
      "break" "catch" "throw" "yield" "await" "switch" "unless" "return" "finally" "continue")
    (group $Token.keyword.declaration+512 "class")
    (group $Token.keyword.declaration+1024 "extends")
    (group $Token.keyword.operator "is" "or" "and" "not" "isnt" "delete" "typeof" "instanceof")
    (group $Token.keyword+512 "new")
    (group $Token.keyword "debugger")
    (group $Token.boolean+128 "on" "no" "off" "yes" "true" "false")
    (group $Token.constant.builtin+128 "NaN" "null" "Infinity" "undefined")
    (group $Token.variable.special+256 "this" "super" "arguments")
    (group $Token.keyword.import "as" "from" "import" "export" "default"))

  ;; Whether `->` or `=>` follows $p on its line, after an optional flat
  ;; parameter list.
  (func $coffeeArrowAt (param $p i32) (result i32)
    (local $c i32)
    (local.set $p (call $lexSkipSpaceAt (local.get $p)))
    (if (i32.eq (call $templateByte (local.get $p)) (i32.const "("))
      (then
        (block $closed
          (loop $scan
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (local.set $c (call $templateByte (local.get $p)))
            (br_if $closed (i32.eq (local.get $c) (i32.const ")")))
            (if
              (i32.or
                (i32.or (i32.eqz (local.get $c)) (i32.eq (local.get $c) (i32.const "(")))
                (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
              (then (return (i32.const 0))))
            (br $scan)))
        (local.set $p (call $lexSkipSpaceAt (i32.add (local.get $p) (i32.const 1))))))
    (i32.and
      (i32.or
        (i32.eq (call $templateByte (local.get $p)) (i32.const "-"))
        (i32.eq (call $templateByte (local.get $p)) (i32.const "=")))
      (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const ">"))))

;; Returns 0 at the line break or $end; an escape never carries it past the line.
  (func $coffeeRegex (result i32)
    (local $c i32)
    (local $class i32)
    (block $open
      (loop $scan
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (local.set $c (call $templateByte (global.get $ptr)))
        (br_if $open (i32.ge_u (global.get $ptr) (global.get $end)))
        (br_if $open (byteset.get "\n\r" (local.get $c)))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (local.set $c (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
            (br_if $scan
              (i32.or
                (byteset.get "\n\r" (local.get $c))
                (i32.ge_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $scan)))
        (if (i32.le_u (i32.sub (local.get $c) (i32.const "[")) (i32.const 2))
          (then (local.set $class (i32.eq (local.get $c) (i32.const "[")))))
        (br_if $scan (i32.or (i32.ne (local.get $c) (i32.const "/")) (local.get $class)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $lexScanIdent)
        (return (i32.const 1))))
    (i32.const 0))

  ;; $lq: the quote byte, plus 256 for `'''`, `"""`, or `///`. $nested: a literal
  ;; inside an interpolation, which keeps `#{` as text. Returns 1 past the closer,
  ;; 2 past `#{`, 0 at $end.
  (func $coffeeLiteral (param $lq i32) (param $nested i32) (result i32)
    (local $c i32)
    (local $e i32)
    (local $hl i32)
    (local $q i32)
    (local $seg i32)
    (local $triple i32)
    (local.set $q (i32.and (local.get $lq) (i32.const 255)))
    (local.set $triple (i32.shr_u (local.get $lq) (i32.const 8)))
    (local.set $hl
      (select
        (enum.get $Token.string.regex)
        (enum.get $Token.string)
        (i32.eq (local.get $q) (i32.const "/"))))
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
            (select (local.get $q) (i32.const "#") (i32.eq (local.get $q) (i32.const 39)))))
        (if (i32.ge_u (global.get $ptr) (global.get $end))
          (then
            (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
            (br $done (i32.const 0))))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
            (local.set $e (call $lexEscapeEnd (global.get $ptr)))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (local.get $e))
            (br $scan)))
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (if
              (i32.and
                (i32.eqz (local.get $nested))
                (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "{")))
              (then
                (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
                (local.set $seg (global.get $ptr))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $seg) (global.get $ptr))
                (br $done (i32.const 2))))
            ;; a chunk starts a line, so its first byte follows a line break
            (if
              (i32.and
                (i32.eq (local.get $q) (i32.const "/"))
                (i32.or
                  (i32.le_u (global.get $ptr) (global.get $srcBase))
                  (call $lexIsSpace (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))))))
              (then
                (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
                (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
                (local.set $seg (global.get $ptr))
                (br $scan)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $scan)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (if (local.get $triple)
          (then
            (br_if $scan
              (i32.or
                (i32.ne (call $templateByte (global.get $ptr)) (local.get $q))
                (i32.ne (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (local.get $q))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))))
        (if (i32.eq (local.get $q) (i32.const "/"))
          (then (call $lexScanIdent)))
        (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
        (i32.const 1))))

  ;; Each line is its own JavaScript range, so line-fed chunks match whole runs.
  (func $coffeeJs (param $triple i32) (result i32)
    (local $c i32)
    (local $p i32)
    (local $save i32)
    (block $done
      (result i32)
      (loop $line
        (result i32)
        (local.set $p (global.get $ptr))
        (block $found
          (loop $find
            (local.set $p
              (call $scanFindSpecial (local.get $p) (global.get $end) (i32.const "`") (i32.const 1) (i32.const 1)))
            (br_if $found (i32.ge_u (local.get $p) (global.get $end)))
            ;; an escape skips its byte, but never a line break
            (if (i32.eq (i32.load8_u (local.get $p)) (i32.const 92))
              (then
                (local.set $c (call $templateByte (i32.add (local.get $p) (i32.const 1))))
                (local.set $p
                  (if (result i32)
                    (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))
                    (then (i32.add (local.get $p) (i32.const 1)))
                    (else (call $lexEscapeEnd (local.get $p)))))
                (br $find)))
            (br_if $found (i32.ne (i32.load8_u (local.get $p)) (i32.const "`")))
            (br_if $found (i32.eqz (local.get $triple)))
            (br_if $found
              (i32.and
                (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const "`"))
                (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 2))) (i32.const "`"))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $find)))
        (if (i32.lt_u (global.get $ptr) (local.get $p))
          (then
            (local.set $save (global.get $end))
            (global.set $end (local.get $p))
            (call $hlJs)
            (call $ecmaReset)
            (global.set $end (local.get $save))
            (global.set $ptr (local.get $p))))
        (br_if $done (i32.const 0) (i32.ge_u (local.get $p) (global.get $end)))
        (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "`"))
          (then
            (global.set $ptr
              (i32.add (local.get $p) (select (i32.const 3) (i32.const 1) (local.get $triple))))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $p) (global.get $ptr))
            (br $done (i32.const 1))))
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (call $emitGap (local.get $p) (global.get $ptr))
        (br $line))))

  ;; $lq: the open literal; $iq: the literal an interpolation suspends; $depth:
  ;; braces inside it. $prev: a `/` after the last token is 0 a regex, 1 a
  ;; division, 2 a regex only when spaced (`f /x/` calls f). $divide: a spaced
  ;; `/` on this line was a division. A line break ends any expression for `/`.
  (func $hlCoffee
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
    (local $prev i32)
    (local $member i32)
    (local $decl i32)
    (local $params i32)
    (local $param i32)
    (local $divide i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (block $tok
        (if (local.get $lq)
          (then
            (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $v
              (if (result i32) (i32.eq (i32.and (local.get $lq) (i32.const 255)) (i32.const "`"))
                (then (call $coffeeJs (i32.shr_u (local.get $lq) (i32.const 8))))
                (else (call $coffeeLiteral (local.get $lq) (local.get $iq)))))
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
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then
            (local.set $prev (i32.const 0))
            (local.set $divide (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))

        ;; comments leave all state as is
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (global.set $ptr (local.get $lhs))
            (if
              (i32.and
                (i32.and
                  (i32.eq (local.get $c2) (i32.const "#"))
                  (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "#")))
                (i32.ne (call $templateByte (i32.add (local.get $lhs) (i32.const 3))) (i32.const "#")))
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
                  (then (call $streamSetFixed32 (i32.const "###") (i32.const 3) (enum.get $Token.comment)))))
              (else (call $lexLineComment (i32.const 1) (enum.get $Token.comment))))
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

        (if
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
            (i32.or
              (i32.eq (local.get $c) (i32.const "`"))
              (i32.and
                (i32.eq (local.get $c) (i32.const "/"))
                (i32.and
                  (i32.eq (local.get $c2) (i32.const "/"))
                  (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "/"))))))
          (then
            (local.set $lq (local.get $c))
            (if
              (i32.and
                (i32.eq (local.get $c2) (local.get $c))
                (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (local.get $c)))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))
                (local.set $lq (i32.or (local.get $c) (i32.const 256)))))
            (local.set $hl
              (select
                (enum.get $Token.string.regex)
                (select
                  (enum.get $Token.punctuation.special)
                  (enum.get $Token.string)
                  (i32.eq (local.get $c) (i32.const "`")))
                (i32.eq (local.get $c) (i32.const "/"))))
            (br $tok)))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.ne (local.get $c2) (i32.const "/")))
          (then
            (if
              (i32.or
                (i32.eqz (local.get $prev))
                (i32.and
                  (i32.eq (local.get $prev) (i32.const 2))
                  (i32.and
                    (i32.and (i32.gt_u (local.get $lhs) (local.get $gap)) (i32.eqz (local.get $divide)))
                    (i32.eqz
                      (call $lexIsSpace
                        (call $templateByte
                          (i32.add
                            (local.get $lhs)
                            (i32.add (i32.const 1) (i32.eq (local.get $c2) (i32.const "="))))))))))
              (then
                ;; After a name a spaced `/` is a division, and so is every later one on the
                ;; line, so no line is rescanned.
                (global.set $ptr (local.get $lhs))
                (if (i32.or (call $coffeeRegex) (i32.eqz (local.get $prev)))
                  (then
                    (local.set $hl (enum.get $Token.string.regex))
                    (local.set $prev (i32.const 1))
                    (br $tok)))
                (local.set $divide (i32.const 1))
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))))))

        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (global.set $ptr (local.get $lhs))
            (call $lexScanNumber)
            (local.set $hl (enum.get $Token.number))
            (local.set $prev (i32.const 1))
            (br $tok)))

        (if (i32.or (call $lexIsIdentStart (local.get $c)) (i32.eq (local.get $c) (i32.const "@")))
          (then
            (call $lexScanIdent)
            (local.set $prev (i32.const 2))
            (local.set $v (i32.const -1))
            (if (i32.eqz (i32.or (local.get $member) (i32.eq (local.get $c) (i32.const "@"))))
              (then (local.set $v (keyword-table.value $coffeeWords (local.get $lhs) (global.get $ptr)))))
            (if (i32.ne (local.get $v) (i32.const -1))
              (then
                (local.set $hl (i32.and (local.get $v) (i32.const 127)))
                (local.set $prev (i32.and (i32.shr_u (local.get $v) (i32.const 7)) (i32.const 3)))
                (local.set $p (i32.shr_u (local.get $v) (i32.const 9)))
                (local.set $member (i32.const 0))
                (local.set $param (i32.const 0))
                (local.set $decl (local.get $p))
                (br $tok)))
            (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
            (local.set $c2 (call $templateByte (local.get $p)))
            (local.set $hl
              (select (enum.get $Token.variable.special) (enum.get $Token.variable) (i32.eq (local.get $c) (i32.const "@"))))
            (block $named
              (if (local.get $decl)
                (then
                  (local.set $hl
                    (select (enum.get $Token.type.class) (enum.get $Token.type) (i32.eq (local.get $decl) (i32.const 1))))
                  (br $named)))
              (if
                (i32.or
                  (i32.and
                    (i32.eq (local.get $c2) (i32.const ":"))
                    (i32.ne (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const ":")))
                  (i32.and
                    (i32.eq (local.get $c2) (i32.const "="))
                    (i32.and
                      (i32.ne (local.tee $v (call $templateByte (i32.add (local.get $p) (i32.const 1)))) (i32.const "="))
                      (i32.ne (local.get $v) (i32.const ">")))))
                (then
                  (if (call $coffeeArrowAt (i32.add (local.get $p) (i32.const 1)))
                    (then
                      (local.set $hl (enum.get $Token.function.definition))
                      (br $named)))))
              (br_if $named (i32.eq (local.get $c) (i32.const "@")))
              (if (local.get $param)
                (then
                  (local.set $hl (enum.get $Token.variable.parameter))
                  (br $named)))
              (if (i32.and (i32.eq (local.get $c2) (i32.const ":")) (i32.eqz (local.get $member)))
                (then
                  (if (i32.ne (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const ":"))
                    (then
                      (local.set $hl (enum.get $Token.property))
                      (br $named)))))
              (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "("))
                (then
                  (local.set $hl
                    (select (enum.get $Token.function.method) (enum.get $Token.function) (local.get $member)))
                  (br $named)))
              (if (local.get $member)
                (then
                  (local.set $hl (enum.get $Token.property))
                  (br $named)))
              (if (call $lexIsConstCase (local.get $lhs) (global.get $ptr))
                (then
                  (local.set $hl (enum.get $Token.constant))
                  (br $named)))
              (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                (then (local.set $hl (enum.get $Token.type)))))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (local.set $param (i32.const 0))
            (br $tok)))

        (local.set $v (local.get $prev))
        (local.set $prev (i32.const 0))
        (local.set $hl (enum.get $Token.punctuation.bracket))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (if (i32.and (i32.ne (local.get $iq) (i32.const 0)) (i32.eq (local.get $c) (i32.const "{")))
              (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
            (if (byteset.get ")]}" (local.get $c))
              (then
                (local.set $prev (i32.const 2))
                (local.set $params (i32.const 0))))
            (if
              (i32.and
                (i32.eq (local.get $c) (i32.const "("))
                (i32.or
                  (i32.ne (local.get $v) (i32.const 2))
                  (i32.gt_u (local.get $lhs) (local.get $gap))))
              (then
                (local.set $params (call $coffeeArrowAt (local.get $lhs)))
                (local.set $param (local.get $params))))
            (local.set $member (i32.const 0))
            (local.set $decl (i32.const 0))
            (br $tok)))
        (local.set $param (i32.const 0))
        (local.set $member (i32.const 0))
        (local.set $decl (i32.const 0))
        (local.set $hl (enum.get $Token.punctuation.delimiter))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (local.set $param (local.get $params))
            (br $tok)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (if (i32.eq (local.get $c2) (i32.const "."))
              (then
                (global.set $ptr
                  (i32.add
                    (global.get $ptr)
                    (i32.add (i32.const 1) (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const ".")))))
                (local.set $param (local.get $params))
                (local.set $hl (enum.get $Token.operator))
                (br $tok)))
            (local.set $member (i32.const 1))
            (br $tok)))
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (if (i32.eq (local.get $c2) (i32.const ":"))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (local.set $member (i32.const 1))))
            (br $tok)))
        (if
          (i32.and
            (i32.or (i32.eq (local.get $c) (i32.const "=")) (i32.eq (local.get $c) (i32.const "-")))
            (i32.eq (local.get $c2) (i32.const ">")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $params (i32.const 0))
            (local.set $hl (enum.get $Token.keyword.declaration))
            (br $tok)))
        (if (byteset.get "!%&*+-/<=>?^|~" (local.get $c))
          (then
            (block $opDone
              (loop $op
                (local.set $c (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eqz (byteset.get "!%&*+-/<=>?^|~" (local.get $c))))
                (br_if $opDone
                  (i32.and
                    (i32.or (i32.eq (local.get $c) (i32.const "=")) (i32.eq (local.get $c) (i32.const "-")))
                    (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const ">"))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (if (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const "?"))
              (then (local.set $prev (local.get $v))))
            (local.set $hl (enum.get $Token.operator))
            (br $tok)))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (local.set $hl (enum.get $Token.none)))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
