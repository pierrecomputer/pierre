(module
  (import "../common.wat")

  ;; High byte: capture the next name as 1 a type, 2 a function, 3 a module path
  ;; up to `;`, 4 a variable (no call before `(`).
  (keyword-table $haxeWords $mem.haxeWords $mem.qmlWords
    (group $Token.keyword.control
      "if" "else" "for" "while" "do" "switch" "case" "default" "break" "continue" "return" "try"
      "catch" "throw")
    (group $Token.keyword.declaration+256
      "class" "interface" "enum" "abstract" "typedef" "extends" "implements")
    (group $Token.keyword.declaration+512 "function")
    (group $Token.keyword.import+768 "package" "import" "using")
    (group $Token.keyword.declaration+1024 "var" "final")
    (group $Token.keyword.declaration
      "static" "public" "private" "inline" "override" "dynamic" "extern" "overload" "operator")
    (group $Token.keyword "macro" "never")
    (group $Token.type.builtin
      "Int" "Float" "Bool" "String" "Void" "Dynamic" "Array" "Map" "Null" "Any" "UInt" "Class")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "null")
    (group $Token.variable.special "this" "super")
    (group $Token.keyword.operator "in" "is" "new" "cast" "untyped"))

  ;; Returns 1 past the closing quote, 2 past a `${`, 0 at $end. $interp keeps a
  ;; nested `${` as text, so one brace depth suffices.
  (func $hxStringBody (param $quote i32) (param $interp i32) (result i32)
    (local $c i32)
    (local $e i32)
    (local $seg i32)
    (local.set $seg (global.get $ptr))
    (block $done
      (loop $scan
        (global.set $ptr
          (call $scanFind3
            (global.get $ptr)
            (local.get $quote)
            (i32.const 92)
            (select (i32.const "$") (local.get $quote) (i32.eq (local.get $quote) (i32.const 39)))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $quote))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (return (i32.const 1))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $e (call $lexCEscapeEnd (global.get $ptr)))
            (if
              (i32.and
                (i32.eq (local.get $e) (i32.add (global.get $ptr) (i32.const 2)))
                (i32.and
                  (i32.eq (i32.load8_u offset=1 (global.get $ptr)) (i32.const "u"))
                  (i32.eq (call $templateByte (local.get $e)) (i32.const "{"))))
              (then
                (local.set $e (call $scanHexRun (i32.add (local.get $e) (i32.const 1)) (i32.const 6)))
                (if (i32.eq (call $templateByte (local.get $e)) (i32.const "}"))
                  (then (local.set $e (i32.add (local.get $e) (i32.const 1)))))))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (local.get $e))
            (br $scan)))
        (local.set $seg (call $stringDollarAt (local.get $seg) (i32.const 8) (local.get $interp)))
        (br_if $scan (i32.ge_s (local.get $seg) (i32.const 0)))
        (return (i32.const 2))))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (i32.const 0))

  (func $hxCondEnd (param $p i32) (result i32)
    (local $c i32)
    (local $depth i32)
    (local.set $p (call $lexSkipSpaceAt (local.get $p)))
    (if (i32.eq (call $templateByte (local.get $p)) (i32.const "!"))
      (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
    (block $done
      (loop $scan
        (local.set $c (call $templateByte (local.get $p)))
        (br_if $done (i32.or (i32.eqz (local.get $c)) (byteset.get "\n\r" (local.get $c))))
        (if (i32.eq (local.get $c) (i32.const "("))
          (then (local.set $depth (i32.add (local.get $depth) (i32.const 1))))
          (else
            (if (i32.eq (local.get $c) (i32.const ")"))
              (then
                (br_if $done (i32.eqz (local.get $depth)))
                (local.set $depth (i32.sub (local.get $depth) (i32.const 1))))
              (else
                (br_if $done
                  (i32.and
                    (i32.eqz (local.get $depth))
                    (i32.eqz
                      (i32.or
                        (call $lexIsIdentContinue (local.get $c))
                        (i32.eq (local.get $c) (i32.const "."))))))))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br_if $scan (local.get $depth))
        (br_if $done (i32.eq (local.get $c) (i32.const ")")))
        (br $scan)))
    (local.get $p))

  ;; $strKind: the quote of an open string. $interp: braces inside a `${`;
  ;; $interpKind: the quote to return to. $expect: the pending capture.
  (func $hlHaxe
    (local $c i32)
    (local $c2 i32)
    (local $c3 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $hl i32)
    (local $expect i32)
    (local $member i32)
    (local $atMember i32)
    (local $upper i32)
    (local $isVar i32)
    (local $strKind i32)
    (local $interp i32)
    (local $interpKind i32)
    (local $status i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (if (local.get $strKind)
          (then
            (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $status (call $hxStringBody (local.get $strKind) (local.get $interp)))
            (if (i32.eq (local.get $status) (i32.const 2))
              (then
                (local.set $interpKind (local.get $strKind))
                (local.set $interp (i32.const 1))
                (local.set $strKind (i32.const 0))))
            (if (i32.eq (local.get $status) (i32.const 1))
              (then (local.set $strKind (i32.const 0))))
            (br $next)))

        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $templateByte (i32.add (global.get $ptr) (i32.const 2))))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment
              (i32.const 2)
              (select
                (enum.get $Token.comment.doc)
                (enum.get $Token.comment)
                (i32.and
                  (i32.eq (local.get $c3) (i32.const "*"))
                  (i32.ne
                    (call $templateByte (i32.add (global.get $ptr) (i32.const 3)))
                    (i32.const "/")))))
            (br $next)))
        (local.set $atMember (local.get $member))
        (local.set $member (i32.const 0))

        ;; the body is scanned at the top of the loop, where it also resumes a chunk
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $strKind (local.get $c))
            (br $next)))

        (if (i32.and (i32.eq (local.get $c) (i32.const "~")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (block $rxDone
              (loop $rx
                (global.set $ptr
                  (call $scanFindSpecial
                    (global.get $ptr)
                    (global.get $end)
                    (i32.const "/")
                    (i32.const 1)
                    (i32.const 1)))
                (br_if $rxDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c (i32.load8_u (global.get $ptr)))
                (if (i32.eq (local.get $c) (i32.const "/"))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (call $scanIdentRun (i32.const "_"))
                    (br $rxDone)))
                (br_if $rxDone (i32.ne (local.get $c) (i32.const 92)))
                ;; an escaped line break would hide the line end from a line-fed chunk
                (local.set $c (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
                (br_if $rxDone
                  (i32.or (i32.eqz (local.get $c)) (byteset.get "\n\r" (local.get $c))))
                (global.set $ptr
                  (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 2)) (global.get $end)))
                (br $rx)))
            (call $emitTok (enum.get $Token.string.regex) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (i32.and (i32.eq (local.get $c) (i32.const "#")) (call $lexIsIdentStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (local.set $rhs (i32.sub (global.get $ptr) (local.get $lhs)))
            (if
              (i32.or
                (i32.and
                  (i32.eq (local.get $rhs) (i32.const 3))
                  (i32.eq (i32.load16_u offset=1 (local.get $lhs)) (i32.const "if")))
                (i32.and
                  (i32.eq (local.get $rhs) (i32.const 7))
                  (i64.eq
                    (i64.and (i64.load offset=1 (local.get $lhs)) (i64.const 0xffffffffffff))
                    (i64.const "elseif"))))
              (then (global.set $ptr (call $hxCondEnd (global.get $ptr)))))
            (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "@"))
            (i32.or (i32.eq (local.get $c2) (i32.const ":")) (call $lexIsIdentStart (local.get $c2))))
          (then
            (global.set $ptr
              (i32.add
                (global.get $ptr)
                (select (i32.const 2) (i32.const 1) (i32.eq (local.get $c2) (i32.const ":")))))
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (local.set $c2 (call $templateByte (call $lexSkipSpaceAt (local.get $rhs))))
            (local.set $hl (i32.const -1))
            (if (i32.eqz (local.get $atMember))
              (then (local.set $hl (keyword-table.value $haxeWords (local.get $lhs) (local.get $rhs)))))
            (block $classified
              (if (i32.eq (local.get $expect) (i32.const 2))
                (then
                  (local.set $hl (enum.get $Token.function.definition))
                  (local.set $expect (i32.const 0))
                  (br $classified)))
              (if (i32.ge_s (local.get $hl) (i32.const 0))
                (then
                  (local.set $expect (i32.shr_u (local.get $hl) (i32.const 8)))
                  (local.set $hl (i32.and (local.get $hl) (i32.const 255)))
                  (br $classified)))
              (local.set $upper (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))
              (if (i32.eq (local.get $expect) (i32.const 1))
                (then
                  (local.set $hl (enum.get $Token.type))
                  (local.set $expect (i32.const 0))
                  (br $classified)))
              (if (i32.eq (local.get $expect) (i32.const 3))
                (then
                  (local.set $hl
                    (select (enum.get $Token.type) (enum.get $Token.namespace) (local.get $upper)))
                  (br $classified)))
              ;; `var name(get, set)` declares a property, not a call
              (local.set $isVar (i32.eq (local.get $expect) (i32.const 4)))
              (local.set $expect (i32.const 0))
              (if (i32.and (i32.eq (local.get $c2) (i32.const "(")) (i32.eqz (local.get $isVar)))
                (then
                  (local.set $hl
                    (select
                      (enum.get $Token.type)
                      (select
                        (enum.get $Token.function.method)
                        (enum.get $Token.function)
                        (local.get $atMember))
                      (local.get $upper)))
                  (br $classified)))
              (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                (then
                  (local.set $hl (enum.get $Token.constant))
                  (br $classified)))
              (local.set $hl
                (select
                  (enum.get $Token.type)
                  (select (enum.get $Token.property) (enum.get $Token.variable) (local.get $atMember))
                  (local.get $upper))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (local.set $expect (i32.const 0))
            (if (local.get $interp)
              (then
                (if (i32.eq (local.get $c) (i32.const "{"))
                  (then (local.set $interp (i32.add (local.get $interp) (i32.const 1)))))
                (if (i32.eq (local.get $c) (i32.const "}"))
                  (then
                    (local.set $interp (i32.sub (local.get $interp) (i32.const 1)))
                    (if (i32.eqz (local.get $interp))
                      (then
                        (call $emitTok
                          (enum.get $Token.punctuation.special)
                          (local.get $lhs)
                          (global.get $ptr))
                        (local.set $strKind (local.get $interpKind))
                        (local.set $interpKind (i32.const 0))
                        (br $next)))))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get ",:;" (local.get $c))
          (then
            (if (i32.ne (local.get $c) (i32.const ":"))
              (then (local.set $expect (i32.const 0))))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (if (i32.and (i32.eq (local.get $c2) (i32.const ".")) (i32.eq (local.get $c3) (i32.const ".")))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 1))
            (br $next)))
        (if (byteset.get "!%&*+-/<=>?^|~" (local.get $c))
          (then
            (block $opDone
              (loop $op
                (local.set $c (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eqz (byteset.get "!%&*+-/<=>?^|~" (local.get $c))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
